"""
audit_db.py — Optional Audit Persistence (E7)
=============================================
Optional SQLite database for privacy-minimized audit logging.
"""

import sqlite3
import os
import json
from typing import Optional
from datetime import datetime, timedelta, timezone

class AuditDB:
    def __init__(self, db_path: str = "data/aegis_audit.db", enabled: bool = False):
        self.enabled = enabled
        self.db_path = db_path
        
        if self.enabled:
            os.makedirs(os.path.dirname(self.db_path), exist_ok=True)
            self._init_db()

    def _get_conn(self):
        # Enable WAL mode for async safety + FK cascades
        conn = sqlite3.connect(self.db_path, isolation_level=None)
        conn.execute('pragma journal_mode=wal')
        conn.execute('pragma foreign_keys=ON')
        return conn

    def _init_db(self):
        with self._get_conn() as conn:
            cursor = conn.cursor()
            
            # 6.6 audit_sessions
            cursor.execute('''
            CREATE TABLE IF NOT EXISTS audit_sessions (
                session_id          TEXT PRIMARY KEY,
                protocol_version    TEXT NOT NULL,
                extension_version   TEXT NOT NULL,
                browser             TEXT NOT NULL CHECK (browser IN ('chrome', 'edge')),
                browser_version     TEXT NOT NULL,
                start_time          TEXT NOT NULL,
                end_time            TEXT,
                total_steps         INTEGER NOT NULL DEFAULT 0 CHECK (total_steps >= 0),
                termination_reason  TEXT CHECK (termination_reason IN (
                                        'goal_achieved', 'agent_failed', 'user_cancelled',
                                        'max_steps_reached', 'stuck_detected',
                                        'repeated_failures', 'connection_error',
                                        'session_timeout', 'unknown'
                                    )),
                is_success          INTEGER NOT NULL DEFAULT 0 CHECK (is_success IN (0, 1)),
                created_at          TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP)
            );
            ''')
            
            # 6.7 audit_actions
            cursor.execute('''
            CREATE TABLE IF NOT EXISTS audit_actions (
                action_id               INTEGER PRIMARY KEY AUTOINCREMENT,
                session_id              TEXT NOT NULL REFERENCES audit_sessions(session_id) ON DELETE CASCADE,
                step_number             INTEGER NOT NULL CHECK (step_number >= 1),
                action_type             TEXT NOT NULL CHECK (action_type IN (
                                            'click', 'type', 'scroll', 'select',
                                            'hover', 'wait', 'done', 'fail'
                                        )),
                target_element_id       TEXT,
                sanitized_target_role   TEXT,
                value_classification    TEXT NOT NULL DEFAULT 'NON_SENSITIVE' CHECK (value_classification IN (
                                            'NON_SENSITIVE', 'LOCAL_INPUT_PROVIDED', 'LOCAL_INPUT_CANCELLED',
                                            'NONE', 'SCROLL_DIRECTION', 'SELECT_OPTION'
                                        )),
                action_value_safe       TEXT,
                vlm_reasoning           TEXT,
                risk_category           TEXT,
                confirmation_required   INTEGER NOT NULL DEFAULT 0 CHECK (confirmation_required IN (0, 1)),
                confirmation_outcome    TEXT CHECK (confirmation_outcome IN (
                                            'APPROVED', 'DENIED_USER', 'DENIED_RISK_ENGINE', 'NOT_REQUIRED'
                                        )),
                execution_status        TEXT NOT NULL CHECK (execution_status IN (
                                            'SUCCESS', 'FAILED', 'BLOCKED', 'SKIPPED'
                                        )),
                error_code              TEXT,
                timestamp               TEXT NOT NULL,
                UNIQUE (session_id, step_number)
            );
            ''')
            
            # 6.8 audit_metrics
            cursor.execute('''
            CREATE TABLE IF NOT EXISTS audit_metrics (
                metric_id                   INTEGER PRIMARY KEY AUTOINCREMENT,
                session_id                  TEXT NOT NULL REFERENCES audit_sessions(session_id) ON DELETE CASCADE,
                step_number                 INTEGER NOT NULL CHECK (step_number >= 1),
                capture_latency_ms          REAL,
                perception_latency_ms       REAL,
                sanitization_latency_ms     REAL,
                vlm_latency_ms              REAL,
                execution_latency_ms        REAL,
                total_cycle_latency_ms      REAL,
                dom_elements_total          INTEGER,
                pii_entities_detected       INTEGER,
                faces_detected              INTEGER,
                screenshot_payload_bytes    INTEGER,
                schema_payload_bytes        INTEGER,
                timestamp                   TEXT NOT NULL,
                UNIQUE (session_id, step_number)
            );
            ''')
            
            # 6.9 audit_security_events
            cursor.execute('''
            CREATE TABLE IF NOT EXISTS audit_security_events (
                event_id            INTEGER PRIMARY KEY AUTOINCREMENT,
                session_id          TEXT NOT NULL REFERENCES audit_sessions(session_id) ON DELETE CASCADE,
                step_number         INTEGER,
                event_type          TEXT NOT NULL CHECK (event_type IN (
                                        'RISK_CONFIRMATION_REQUESTED',
                                        'RISK_ACTION_APPROVED',
                                        'RISK_ACTION_DENIED_USER',
                                        'RISK_ACTION_BLOCKED_ENGINE',
                                        'PII_OVER_REDACTION_TRIGGERED',
                                        'PAYLOAD_VALIDATION_FAILED',
                                        'MALFORMED_MESSAGE',
                                        'AUTHENTICATION_FAILURE'
                                    )),
                risk_code           TEXT,
                severity            TEXT NOT NULL CHECK (severity IN ('INFO', 'WARNING', 'HIGH', 'CRITICAL')),
                event_details       TEXT,
                timestamp           TEXT NOT NULL
            );
            ''')
            
            # 6.10 schema_migrations
            cursor.execute('''
            CREATE TABLE IF NOT EXISTS schema_migrations (
                version     INTEGER PRIMARY KEY,
                name        TEXT NOT NULL,
                applied_at  TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP)
            );
            ''')

    def record_session_start(self, session_id: str, protocol_version: str, client_metadata: dict, start_time: str):
        if not self.enabled: return
        with self._get_conn() as conn:
            conn.execute('''
            INSERT INTO audit_sessions (session_id, protocol_version, extension_version, browser, browser_version, start_time)
            VALUES (?, ?, ?, ?, ?, ?)
            ''', (
                session_id,
                protocol_version,
                client_metadata.get("extension_version", "unknown"),
                client_metadata.get("browser", "chrome"),
                client_metadata.get("browser_version", "unknown"),
                start_time
            ))

    def record_session_end(self, session_id: str, end_time: str, total_steps: int, termination_reason: str, is_success: bool):
        if not self.enabled: return
        with self._get_conn() as conn:
            conn.execute('''
            UPDATE audit_sessions
            SET end_time = ?, total_steps = ?, termination_reason = ?, is_success = ?
            WHERE session_id = ?
            ''', (end_time, total_steps, termination_reason, 1 if is_success else 0, session_id))

    def record_action(self, session_id: str, step_number: int, action_type: str, target_element_id: Optional[str],
                      sanitized_target_role: Optional[str], value_classification: str, action_value_safe: Optional[str],
                      vlm_reasoning: Optional[str], risk_category: Optional[str], confirmation_required: bool,
                      confirmation_outcome: Optional[str], execution_status: str, error_code: Optional[str],
                      timestamp: str):
        if not self.enabled: return
        
        # Privacy enforcement
        if vlm_reasoning:
            vlm_reasoning = vlm_reasoning[:1000]
            
        with self._get_conn() as conn:
            conn.execute('''
            INSERT OR IGNORE INTO audit_actions (
                session_id, step_number, action_type, target_element_id, sanitized_target_role,
                value_classification, action_value_safe, vlm_reasoning, risk_category, confirmation_required,
                confirmation_outcome, execution_status, error_code, timestamp
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ''', (
                session_id, step_number, action_type, target_element_id, sanitized_target_role,
                value_classification, action_value_safe, vlm_reasoning, risk_category,
                1 if confirmation_required else 0, confirmation_outcome, execution_status, error_code, timestamp
            ))
            
    def record_metric(self, session_id: str, step_number: int, timestamp: str, **kwargs):
        if not self.enabled: return
        fields = ['capture_latency_ms', 'perception_latency_ms', 'sanitization_latency_ms',
                 'vlm_latency_ms', 'execution_latency_ms', 'total_cycle_latency_ms',
                 'dom_elements_total', 'pii_entities_detected', 'faces_detected',
                 'screenshot_payload_bytes', 'schema_payload_bytes']
        
        cols = ['session_id', 'step_number', 'timestamp']
        vals = [session_id, step_number, timestamp]
        for f in fields:
            if f in kwargs:
                cols.append(f)
                vals.append(kwargs[f])
                
        placeholders = ', '.join(['?'] * len(cols))
        query = f"INSERT OR IGNORE INTO audit_metrics ({', '.join(cols)}) VALUES ({placeholders})"
        
        with self._get_conn() as conn:
            conn.execute(query, tuple(vals))

    def record_security_event(self, session_id: str, event_type: str, severity: str, timestamp: str, 
                              step_number: Optional[int] = None, risk_code: Optional[str] = None, event_details: Optional[str] = None):
        if not self.enabled: return
        with self._get_conn() as conn:
            conn.execute('''
            INSERT INTO audit_security_events (session_id, step_number, event_type, risk_code, severity, event_details, timestamp)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            ''', (session_id, step_number, event_type, risk_code, severity, event_details, timestamp))

    def cleanup_old_records(self, days: int = 7):
        if not self.enabled: return
        cutoff_date = (datetime.now(timezone.utc) - timedelta(days=days)).isoformat()
        with self._get_conn() as conn:
            # Due to ON DELETE CASCADE, deleting from audit_sessions deletes related rows
            conn.execute("DELETE FROM audit_sessions WHERE start_time < ?", (cutoff_date,))

# Expose a default instance that uses env var
_audit_enabled = os.environ.get("AUDIT_DB_ENABLED", "false").lower() == "true"
audit_db = AuditDB(enabled=_audit_enabled)
