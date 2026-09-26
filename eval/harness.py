import asyncio
import os
import sys
import json
import uuid
import datetime
from playwright.async_api import async_playwright

async def run_fixture(context, fixture_url):
    page = await context.new_page()
    try:
        await page.goto(fixture_url, wait_until="networkidle")
        # Give the extension time to act if needed
        await page.wait_for_timeout(5000)
    except Exception as e:
        print(f"Error running {fixture_url}: {e}")
    finally:
        await page.close()

async def main():
    extension_path = os.path.abspath(os.path.join(os.path.dirname(__file__), "../extension/dist"))
    fixtures_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), "fixtures"))
    
    if not os.path.exists(extension_path):
        print(f"Extension not found at {extension_path}. Please build it first.")
        sys.exit(1)

    run_id = str(uuid.uuid4())
    run_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), f"runs/{run_id}"))
    os.makedirs(run_dir, exist_ok=True)
    
    # Save manifest
    manifest = {
        "run_id": run_id,
        "timestamp": datetime.datetime.utcnow().isoformat() + "Z",
        "eval_mode": True,
        "fixtures": []
    }
    
    # Find all html fixtures
    fixtures = [f for f in os.listdir(fixtures_dir) if f.endswith(".html")]
    
    async with async_playwright() as p:
        user_data_dir = os.path.join(run_dir, "chrome-profile")
        browser_context = await p.chromium.launch_persistent_context(
            user_data_dir,
            headless=False,
            args=[
                f"--disable-extensions-except={extension_path}",
                f"--load-extension={extension_path}",
            ],
            viewport={"width": 1280, "height": 720}
        )
        
        # Optionally wait for the extension service worker
        
        for fixture in fixtures:
            fixture_url = f"file://{os.path.join(fixtures_dir, fixture)}"
            print(f"Running fixture: {fixture_url}")
            await run_fixture(browser_context, fixture_url)
            manifest["fixtures"].append(fixture)
            
        await browser_context.close()
        
    with open(os.path.join(run_dir, "manifest.json"), "w") as f:
        json.dump(manifest, f, indent=2)
        
    print(f"Eval run {run_id} completed. Manifest saved to {run_dir}")

if __name__ == "__main__":
    asyncio.run(main())
