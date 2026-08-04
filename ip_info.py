import threading

try:
    import maxminddb
except ImportError:  # DNS lookups can still run without optional GeoIP support.
    maxminddb = None

from geoip_updater import GEOIP_DIRECTORY


city_reader = None
asn_reader = None
country_reader = None
_reader_lock = threading.RLock()


def initialize_geoip_readers() -> bool:
    """Atomically open or reload all local MaxMind databases."""
    global city_reader, asn_reader, country_reader
    if maxminddb is None:
        print("MaxMind library is not installed; GeoIP enrichment is disabled")
        return False
    new_readers = []
    try:
        new_readers = [
            maxminddb.open_database(GEOIP_DIRECTORY / "GeoLite2-City.mmdb"),
            maxminddb.open_database(GEOIP_DIRECTORY / "GeoLite2-ASN.mmdb"),
            maxminddb.open_database(GEOIP_DIRECTORY / "GeoLite2-Country.mmdb"),
        ]
    except Exception as exc:
        for reader in new_readers:
            reader.close()
        print(f"Error opening MaxMind databases: {exc}")
        return False

    with _reader_lock:
        old_readers = (city_reader, asn_reader, country_reader)
        city_reader, asn_reader, country_reader = new_readers
        for reader in old_readers:
            if reader:
                reader.close()
    print("GeoIP databases initialized successfully")
    return True


def get_ip_info(ip_address: str) -> dict:
    """Retrieve IP geolocation and provider information from local MaxMind data."""
    with _reader_lock:
        if not city_reader or not asn_reader or not country_reader:
            return {"ip": ip_address, "error": "MaxMind databases not initialized"}

        try:
            city_data = city_reader.get(ip_address)
            asn_data = asn_reader.get(ip_address)
            country_data = country_reader.get(ip_address)
        except Exception as exc:
            return {"ip": ip_address, "error": f"Exception occurred while retrieving IP info: {exc}"}

    return {
        "ip": ip_address,
        "city": city_data.get("city", {}).get("names", {}).get("en", "Unknown") if city_data else "Unknown",
        "region": city_data.get("subdivisions", [{}])[0].get("names", {}).get("en", "Unknown") if city_data and city_data.get("subdivisions") else "Unknown",
        "country": country_data.get("country", {}).get("names", {}).get("en", "Unknown") if country_data else "Unknown",
        "org": asn_data.get("autonomous_system_organization", "Unknown") if asn_data else "Unknown",
        "coordinates": (
            f"{city_data.get('location', {}).get('latitude', 'Unknown')},"
            f"{city_data.get('location', {}).get('longitude', 'Unknown')}"
            if city_data and city_data.get("location")
            else "Unknown,Unknown"
        ),
    }
