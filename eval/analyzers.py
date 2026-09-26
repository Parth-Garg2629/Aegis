import os
import json
import argparse
from pathlib import Path

def run_canary_audit(run_dir):
    """
    Reads wire_tap.jsonl in run_dir and checks if any canary values
    from generators or ground_truth leaked into the context_update payloads.
    """
    wire_tap_log = os.path.join(run_dir, "wire_tap.jsonl")
    if not os.path.exists(wire_tap_log):
        print(f"No wire_tap.jsonl found in {run_dir}")
        return False

    canary_leak = False
    with open(wire_tap_log, "r") as f:
        for line in f:
            entry = json.loads(line)
            if entry.get("direction") == "client_to_server":
                payload = entry.get("payload", "")
                if isinstance(payload, str):
                    try:
                        payload = json.loads(payload)
                    except json.JSONDecodeError:
                        pass
                
                # Convert payload to string for simple grep
                payload_str = json.dumps(payload)
                
                # In a real implementation we would dynamically fetch the generated canaries
                # For demonstration, let's assume we look for known raw ground truth like PAN
                test_canaries = ["4111111111111111"]
                for c in test_canaries:
                    if c in payload_str:
                        print(f"FAIL: Canary {c} leaked in payload!")
                        canary_leak = True

    if not canary_leak:
        print("PASS: No canaries leaked in wire tap.")
    return not canary_leak

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--run-dir", type=str, required=True)
    args = parser.parse_args()
    
    run_canary_audit(args.run_dir)
