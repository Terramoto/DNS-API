import os
import threading
import time
from datetime import datetime, timedelta
import requests
import tempfile
import shutil

def ensure_geoip_directory_exists():
    """
    Ensure the geoip_db directory exists, create it if it doesn't.
    """
    if not os.path.exists("geoip_db"):
        try:
            os.makedirs("geoip_db")
            print("Created geoip_db directory")
        except Exception as e:
            print(f"Error creating geoip_db directory: {e}")
            return False
    return True

def should_update_file(filepath, max_age_days=30):
    """
    Check if a file should be updated based on its modification time.
    Returns True if file is older than max_age_days or doesn't exist.
    """
    try:
        if not os.path.exists(filepath):
            return True

        # Get file modification time
        mod_time = datetime.fromtimestamp(os.path.getmtime(filepath))
        current_time = datetime.now()

        # Calculate age in days
        age = (current_time - mod_time).days

        return age >= max_age_days
    except Exception as e:
        print(f"Error checking file age for {filepath}: {e}")
        return True

def download_file(url, destination):
    """
    Download a file from URL to destination with error handling.
    """
    try:
        print(f"Downloading {url}...")
        response = requests.get(url, stream=True, timeout=30)
        response.raise_for_status()

        # Create temp file first
        temp_file = destination + ".tmp"

        with open(temp_file, 'wb') as f:
            for chunk in response.iter_content(chunk_size=8192):
                if chunk:
                    f.write(chunk)

        # Atomic move - replace old file with new one
        shutil.move(temp_file, destination)
        print(f"Successfully updated {destination}")
        return True
    except Exception as e:
        print(f"Error downloading {url}: {e}")
        # Clean up temp file if it exists
        if os.path.exists(temp_file):
            os.remove(temp_file)
        return False

def update_geoip_databases():
    """
    Update GeoIP databases if they are older than 1 month or don't exist.
    """
    print("Starting GeoIP database update check...")

    # Ensure directory exists
    if not ensure_geoip_directory_exists():
        print("Cannot update GeoIP databases: directory creation failed")
        return False

    databases = [
        {
            "url": "https://git.io/GeoLite2-ASN.mmdb",
            "filename": "GeoLite2-ASN.mmdb",
            "path": "geoip_db/GeoLite2-ASN.mmdb"
        },
        {
            "url": "https://git.io/GeoLite2-City.mmdb",
            "filename": "GeoLite2-City.mmdb",
            "path": "geoip_db/GeoLite2-City.mmdb"
        },
        {
            "url": "https://git.io/GeoLite2-Country.mmdb",
            "filename": "GeoLite2-Country.mmdb",
            "path": "geoip_db/GeoLite2-Country.mmdb"
        }
    ]

    updated_any = False

    for db in databases:
        if should_update_file(db["path"]):
            print(f"{db['filename']} needs updating...")
            if download_file(db["url"], db["path"]):
                updated_any = True
        else:
            print(f"{db['filename']} is up to date")

    if updated_any:
        print("GeoIP databases updated successfully!")
    else:
        print("All GeoIP databases are already up to date")

    return updated_any

def start_background_updater(interval_hours=24):
    """
    Start a background thread that periodically checks and updates GeoIP databases.
    """
    def updater_loop():
        while True:
            try:
                update_geoip_databases()
            except Exception as e:
                print(f"Error in GeoIP updater: {e}")

            # Sleep for the specified interval
            time.sleep(interval_hours * 3600)

    # Start the updater thread as a daemon so it doesn't prevent program exit
    updater_thread = threading.Thread(target=updater_loop, daemon=True)
    updater_thread.start()
    print("GeoIP updater background thread started")

    return updater_thread

if __name__ == "__main__":
    # For testing purposes
    update_geoip_databases()
