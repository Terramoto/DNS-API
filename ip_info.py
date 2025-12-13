import maxminddb
import os

# Initialize the MaxMind database readers
def initialize_geoip_readers():
    """
    Initialize MaxMind database readers with proper error handling.
    If databases don't exist, attempt to download them first.
    """
    global city_reader, asn_reader, country_reader

    try:
        # Check if databases exist
        databases_exist = all([
            os.path.exists('geoip_db/GeoLite2-City.mmdb'),
            os.path.exists('geoip_db/GeoLite2-ASN.mmdb'),
            os.path.exists('geoip_db/GeoLite2-Country.mmdb')
        ])

        if not databases_exist:
            print("GeoIP databases not found. Attempting to download...")
            try:
                from geoip_updater import update_geoip_databases
                update_geoip_databases()
            except Exception as e:
                print(f"Failed to download GeoIP databases: {e}")

        # Try to open databases
        city_reader = maxminddb.open_database('geoip_db/GeoLite2-City.mmdb')
        asn_reader = maxminddb.open_database('geoip_db/GeoLite2-ASN.mmdb')
        country_reader = maxminddb.open_database('geoip_db/GeoLite2-Country.mmdb')
        print("GeoIP databases initialized successfully")
        return True

    except Exception as e:
        print(f"Error opening MaxMind databases: {e}")
        city_reader = None
        asn_reader = None
        country_reader = None
        return False

# Initialize readers
initialize_geoip_readers()

def get_ip_info(ip_address: str) -> dict:
    """
    Retrieve IP geolocation and provider information using local MaxMind GeoLite2 databases.
    This is much faster than external API calls.
    """
    if not city_reader or not asn_reader or not country_reader:
        return {
            "ip": ip_address,
            "error": "MaxMind databases not initialized"
        }
    
    try:
        # Get city information
        city_data = city_reader.get(ip_address)
        
        # Get ASN information
        asn_data = asn_reader.get(ip_address)
        
        # Get country information
        country_data = country_reader.get(ip_address)
        
        # Combine all information
        result = {
            "ip": ip_address,
            "city": city_data.get('city', {}).get('names', {}).get('en', 'Unknown') if city_data else 'Unknown',
            "region": city_data.get('subdivisions', [{}])[0].get('names', {}).get('en', 'Unknown') if city_data and city_data.get('subdivisions') else 'Unknown',
            "country": country_data.get('country', {}).get('names', {}).get('en', 'Unknown') if country_data else 'Unknown',
            "org": asn_data.get('autonomous_system_organization', 'Unknown') if asn_data else 'Unknown',
            "coordinates": f"{city_data.get('location', {}).get('latitude', 'Unknown')},{city_data.get('location', {}).get('longitude', 'Unknown')}" if city_data and city_data.get('location') else 'Unknown,Unknown'
        }
        
        return result
    except Exception as e:
        return {
            "ip": ip_address,
            "error": f"Exception occurred while retrieving IP info: {str(e)}"
        }
