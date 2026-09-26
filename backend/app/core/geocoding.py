import math
import numpy as np
from typing import List, Dict, Any, Optional, Tuple
from .schemas import LocationSearchResult, AreaThreatAssessment, LiveWeatherObservation
from .data_generator import REGIONS, generate_spatiotemporal_grid, get_simulated_lightning_strikes
from ..services.weather_api_service import fetch_live_weather, search_openweather_locations, reverse_geocode_location



# Comprehensive database of Indian cities, districts, tech corridors, airports, and landmarks
INDIAN_LOCATIONS: List[Dict[str, Any]] = [
    # --- Hyderabad & Telangana ---
    {"name": "Gachibowli, Hyderabad", "lat": 17.4401, "lon": 78.3489, "category": "locality", "state": "Telangana", "region_id": "hyderabad"},
    {"name": "HITEC City / Madhapur, Hyderabad", "lat": 17.4483, "lon": 78.3748, "category": "locality", "state": "Telangana", "region_id": "hyderabad"},
    {"name": "Banjara Hills, Hyderabad", "lat": 17.4156, "lon": 78.4350, "category": "locality", "state": "Telangana", "region_id": "hyderabad"},
    {"name": "Jubilee Hills, Hyderabad", "lat": 17.4319, "lon": 78.4073, "category": "locality", "state": "Telangana", "region_id": "hyderabad"},
    {"name": "Begumpet (DWR Station), Hyderabad", "lat": 17.4448, "lon": 78.4682, "category": "radar_station", "state": "Telangana", "region_id": "hyderabad"},
    {"name": "Secunderabad Station, Hyderabad", "lat": 17.4344, "lon": 78.5013, "category": "locality", "state": "Telangana", "region_id": "hyderabad"},
    {"name": "Rajiv Gandhi International Airport (RGIA / Shamshabad)", "lat": 17.2403, "lon": 78.4294, "category": "airport", "state": "Telangana", "region_id": "hyderabad"},
    {"name": "Kukatpally, Hyderabad", "lat": 17.4938, "lon": 78.3995, "category": "locality", "state": "Telangana", "region_id": "hyderabad"},
    {"name": "Miyapur, Hyderabad", "lat": 17.4968, "lon": 78.3614, "category": "locality", "state": "Telangana", "region_id": "hyderabad"},
    {"name": "Charminar & Old City, Hyderabad", "lat": 17.3616, "lon": 78.4747, "category": "landmark", "state": "Telangana", "region_id": "hyderabad"},
    {"name": "Uppal & Habsiguda, Hyderabad", "lat": 17.4018, "lon": 78.5583, "category": "locality", "state": "Telangana", "region_id": "hyderabad"},
    {"name": "LB Nagar / Nagole, Hyderabad", "lat": 17.3457, "lon": 78.5522, "category": "locality", "state": "Telangana", "region_id": "hyderabad"},
    {"name": "Kompally & Medchal, Hyderabad", "lat": 17.5385, "lon": 78.4862, "category": "locality", "state": "Telangana", "region_id": "hyderabad"},
    {"name": "Warangal City (Kazipet / Hanamkonda)", "lat": 17.9689, "lon": 79.5941, "category": "city", "state": "Telangana", "region_id": "hyderabad"},
    {"name": "Karimnagar", "lat": 18.4386, "lon": 79.1288, "category": "city", "state": "Telangana", "region_id": "hyderabad"},
    {"name": "Nizamabad", "lat": 18.6725, "lon": 78.0941, "category": "city", "state": "Telangana", "region_id": "hyderabad"},
    {"name": "Khammam", "lat": 17.2473, "lon": 80.1514, "category": "city", "state": "Telangana", "region_id": "hyderabad"},
    {"name": "Mahabubnagar", "lat": 16.7488, "lon": 77.9856, "category": "city", "state": "Telangana", "region_id": "hyderabad"},
    {"name": "Siddipet / Gajwel", "lat": 18.1018, "lon": 78.8520, "category": "city", "state": "Telangana", "region_id": "hyderabad"},
    {"name": "Sangareddy & IIT Hyderabad (Kandi)", "lat": 17.6186, "lon": 78.0816, "category": "locality", "state": "Telangana", "region_id": "hyderabad"},

    # --- Kolkata & West Bengal (Kalbaisakhi Squall Line) ---
    {"name": "Kolkata City Center / Esplanade", "lat": 22.5697, "lon": 88.3500, "category": "city", "state": "West Bengal", "region_id": "kolkata"},
    {"name": "Salt Lake City (Bidhannagar / Sector V), Kolkata", "lat": 22.5804, "lon": 88.4287, "category": "locality", "state": "West Bengal", "region_id": "kolkata"},
    {"name": "New Town (Rajarhat / Eco Park), Kolkata", "lat": 22.6033, "lon": 88.4659, "category": "locality", "state": "West Bengal", "region_id": "kolkata"},
    {"name": "Howrah Station & Bridge, Kolkata", "lat": 22.5850, "lon": 88.3426, "category": "landmark", "state": "West Bengal", "region_id": "kolkata"},
    {"name": "Alipore (DWR Station), Kolkata", "lat": 22.5312, "lon": 88.3283, "category": "radar_station", "state": "West Bengal", "region_id": "kolkata"},
    {"name": "Netaji Subhash Chandra Bose Airport (Dum Dum / CCU)", "lat": 22.6547, "lon": 88.4467, "category": "airport", "state": "West Bengal", "region_id": "kolkata"},
    {"name": "Park Street & Victoria Memorial, Kolkata", "lat": 22.5510, "lon": 88.3524, "category": "landmark", "state": "West Bengal", "region_id": "kolkata"},
    {"name": "Garia & Jadavpur, Kolkata", "lat": 22.4835, "lon": 88.3768, "category": "locality", "state": "West Bengal", "region_id": "kolkata"},
    {"name": "Ballygunge & Behala, Kolkata", "lat": 22.5280, "lon": 88.3650, "category": "locality", "state": "West Bengal", "region_id": "kolkata"},
    {"name": "Barasat & Barrackpore, North 24 Parganas", "lat": 22.7231, "lon": 88.4800, "category": "locality", "state": "West Bengal", "region_id": "kolkata"},
    {"name": "Kalyani & Nadia", "lat": 22.9751, "lon": 88.4345, "category": "city", "state": "West Bengal", "region_id": "kolkata"},
    {"name": "Burdwan (Bardhaman)", "lat": 23.2324, "lon": 87.8615, "category": "city", "state": "West Bengal", "region_id": "kolkata"},
    {"name": "Durgapur Steel City", "lat": 23.5204, "lon": 87.3119, "category": "city", "state": "West Bengal", "region_id": "kolkata"},
    {"name": "Asansol & Raniganj", "lat": 23.6739, "lon": 86.9524, "category": "city", "state": "West Bengal", "region_id": "kolkata"},
    {"name": "Kharagpur & IIT Kharagpur", "lat": 22.3460, "lon": 87.2320, "category": "city", "state": "West Bengal", "region_id": "kolkata"},
    {"name": "Haldia Port", "lat": 22.0667, "lon": 88.0698, "category": "city", "state": "West Bengal", "region_id": "kolkata"},
    {"name": "Siliguri & Jalpaiguri (North Bengal)", "lat": 26.7271, "lon": 88.3953, "category": "city", "state": "West Bengal", "region_id": "guwahati"},

    # --- Delhi-NCR & Western UP ---
    {"name": "Connaught Place (Central Delhi)", "lat": 28.6315, "lon": 77.2167, "category": "landmark", "state": "Delhi", "region_id": "delhi"},
    {"name": "India Gate & Kartavya Path, New Delhi", "lat": 28.6129, "lon": 77.2295, "category": "landmark", "state": "Delhi", "region_id": "delhi"},
    {"name": "Mausam Bhawan (IMD HQ / DWR Lodhi Road), Delhi", "lat": 28.5898, "lon": 77.2223, "category": "radar_station", "state": "Delhi", "region_id": "delhi"},
    {"name": "Indira Gandhi International Airport (IGI / Palam / DEL)", "lat": 28.5562, "lon": 77.1000, "category": "airport", "state": "Delhi", "region_id": "delhi"},
    {"name": "Dwarka & Janakpuri, West Delhi", "lat": 28.5921, "lon": 77.0460, "category": "locality", "state": "Delhi", "region_id": "delhi"},
    {"name": "Rohini & Pitampura, North-West Delhi", "lat": 28.7166, "lon": 77.1126, "category": "locality", "state": "Delhi", "region_id": "delhi"},
    {"name": "Hauz Khas & Saket, South Delhi", "lat": 28.5494, "lon": 77.2001, "category": "locality", "state": "Delhi", "region_id": "delhi"},
    {"name": "Noida Sector 18 & Atta Market, UP", "lat": 28.5708, "lon": 77.3271, "category": "locality", "state": "Uttar Pradesh", "region_id": "delhi"},
    {"name": "Noida Sector 62 & Electronic City", "lat": 28.6280, "lon": 77.3649, "category": "locality", "state": "Uttar Pradesh", "region_id": "delhi"},
    {"name": "Greater Noida & Pari Chowk", "lat": 28.4744, "lon": 77.5040, "category": "city", "state": "Uttar Pradesh", "region_id": "delhi"},
    {"name": "Gurugram Cyber City & DLF Phase 1-5", "lat": 28.4950, "lon": 77.0895, "category": "locality", "state": "Haryana", "region_id": "delhi"},
    {"name": "Gurugram Golf Course Extension & Sohna Road", "lat": 28.4239, "lon": 77.0489, "category": "locality", "state": "Haryana", "region_id": "delhi"},
    {"name": "Faridabad (NIT / Sector 15)", "lat": 28.4089, "lon": 77.3178, "category": "city", "state": "Haryana", "region_id": "delhi"},
    {"name": "Ghaziabad (Indirapuram / Vaishali / Raj Nagar)", "lat": 28.6692, "lon": 77.4538, "category": "city", "state": "Uttar Pradesh", "region_id": "delhi"},
    {"name": "Meerut City & Cantonment", "lat": 28.9845, "lon": 77.7064, "category": "city", "state": "Uttar Pradesh", "region_id": "delhi"},
    {"name": "Sonipat & Panipat", "lat": 28.9931, "lon": 77.0151, "category": "city", "state": "Haryana", "region_id": "delhi"},
    {"name": "Rohtak & Bahadurgarh", "lat": 28.8955, "lon": 76.6066, "category": "city", "state": "Haryana", "region_id": "delhi"},
    {"name": "Agra (Taj Mahal)", "lat": 27.1767, "lon": 78.0081, "category": "city", "state": "Uttar Pradesh", "region_id": "delhi"},

    # --- Bhubaneswar & Coastal Odisha ---
    {"name": "Bhubaneswar City / Master Canteen", "lat": 20.2961, "lon": 85.8245, "category": "city", "state": "Odisha", "region_id": "bhubaneswar"},
    {"name": "Patia & Chandrasekharpur (Infocity), Bhubaneswar", "lat": 20.3541, "lon": 85.8193, "category": "locality", "state": "Odisha", "region_id": "bhubaneswar"},
    {"name": "Khandagiri & Udayagiri Caves, Bhubaneswar", "lat": 20.2592, "lon": 85.7820, "category": "landmark", "state": "Odisha", "region_id": "bhubaneswar"},
    {"name": "Biju Patnaik International Airport (BBI), Bhubaneswar", "lat": 20.2444, "lon": 85.8178, "category": "airport", "state": "Odisha", "region_id": "bhubaneswar"},
    {"name": "Cuttack City (Badambadi / CDA Sector)", "lat": 20.4625, "lon": 85.8828, "category": "city", "state": "Odisha", "region_id": "bhubaneswar"},
    {"name": "Puri (Jagannath Temple & Golden Beach)", "lat": 19.8135, "lon": 85.8312, "category": "city", "state": "Odisha", "region_id": "bhubaneswar"},
    {"name": "Paradip Port (DWR Station), Odisha", "lat": 20.2644, "lon": 86.6083, "category": "radar_station", "state": "Odisha", "region_id": "bhubaneswar"},
    {"name": "Berhampur (Ganjam Coast)", "lat": 19.3150, "lon": 84.7941, "category": "city", "state": "Odisha", "region_id": "bhubaneswar"},
    {"name": "Balasore (Chandipur Missile Test Range)", "lat": 21.4934, "lon": 86.9135, "category": "city", "state": "Odisha", "region_id": "bhubaneswar"},
    {"name": "Rourkela Steel City", "lat": 22.2604, "lon": 84.8536, "category": "city", "state": "Odisha", "region_id": "bhubaneswar"},
    {"name": "Sambalpur (Hirakud Dam)", "lat": 21.4669, "lon": 83.9812, "category": "city", "state": "Odisha", "region_id": "bhubaneswar"},

    # --- Mumbai & Konkan Coast ---
    {"name": "Mumbai City / Nariman Point & Marine Drive", "lat": 18.9256, "lon": 72.8242, "category": "landmark", "state": "Maharashtra", "region_id": "mumbai"},
    {"name": "Colaba (DWR Storm Warning Station), Mumbai", "lat": 18.9067, "lon": 72.8147, "category": "radar_station", "state": "Maharashtra", "region_id": "mumbai"},
    {"name": "Bandra West & Bandstand, Mumbai", "lat": 19.0596, "lon": 72.8295, "category": "locality", "state": "Maharashtra", "region_id": "mumbai"},
    {"name": "Bandra-Kurla Complex (BKC IT Finance), Mumbai", "lat": 19.0657, "lon": 72.8687, "category": "locality", "state": "Maharashtra", "region_id": "mumbai"},
    {"name": "Andheri & Juhu Beach, Mumbai", "lat": 19.1136, "lon": 72.8697, "category": "locality", "state": "Maharashtra", "region_id": "mumbai"},
    {"name": "Chhatrapati Shivaji Maharaj International Airport (BOM / CSMIA)", "lat": 19.0896, "lon": 72.8656, "category": "airport", "state": "Maharashtra", "region_id": "mumbai"},
    {"name": "Powai & IIT Bombay, Mumbai", "lat": 19.1257, "lon": 72.9151, "category": "locality", "state": "Maharashtra", "region_id": "mumbai"},
    {"name": "Borivali & Sanjay Gandhi National Park, Mumbai", "lat": 19.2307, "lon": 72.8567, "category": "locality", "state": "Maharashtra", "region_id": "mumbai"},
    {"name": "Thane City (Ghodbunder / Majiwada)", "lat": 19.2183, "lon": 72.9781, "category": "city", "state": "Maharashtra", "region_id": "mumbai"},
    {"name": "Navi Mumbai (Vashi / Belapur / Kharghar / Panvel)", "lat": 19.0330, "lon": 73.0297, "category": "city", "state": "Maharashtra", "region_id": "mumbai"},
    {"name": "Kalyan & Dombivli", "lat": 19.2403, "lon": 73.1305, "category": "city", "state": "Maharashtra", "region_id": "mumbai"},
    {"name": "Pune City (Shivajinagar / Hinjawadi / Kothrud)", "lat": 18.5204, "lon": 73.8567, "category": "city", "state": "Maharashtra", "region_id": "mumbai"},
    {"name": "Alibaug & Raigad Coast", "lat": 18.6414, "lon": 72.8722, "category": "city", "state": "Maharashtra", "region_id": "mumbai"},
    {"name": "Ratnagiri & Sindhudurg", "lat": 16.9902, "lon": 73.3120, "category": "city", "state": "Maharashtra", "region_id": "mumbai"},
    {"name": "Nashik", "lat": 19.9975, "lon": 73.7898, "category": "city", "state": "Maharashtra", "region_id": "mumbai"},

    # --- Chennai & Coastal Tamil Nadu ---
    {"name": "Chennai City / Marina Beach & Santhome", "lat": 13.0499, "lon": 80.2824, "category": "landmark", "state": "Tamil Nadu", "region_id": "chennai"},
    {"name": "T. Nagar (Thyagaraya Nagar), Chennai", "lat": 13.0418, "lon": 80.2341, "category": "locality", "state": "Tamil Nadu", "region_id": "chennai"},
    {"name": "Adyar & Besant Nagar (Elliot's Beach), Chennai", "lat": 13.0012, "lon": 80.2565, "category": "locality", "state": "Tamil Nadu", "region_id": "chennai"},
    {"name": "OMR / Old Mahabalipuram Road (IT Corridor / Sholinganallur)", "lat": 12.9010, "lon": 80.2279, "category": "locality", "state": "Tamil Nadu", "region_id": "chennai"},
    {"name": "Velachery & Guindy Industrial Estate, Chennai", "lat": 12.9815, "lon": 80.2180, "category": "locality", "state": "Tamil Nadu", "region_id": "chennai"},
    {"name": "Anna Nagar & Kilpauk, Chennai", "lat": 13.0850, "lon": 80.2101, "category": "locality", "state": "Tamil Nadu", "region_id": "chennai"},
    {"name": "Chennai International Airport (Meenambakkam / MAA)", "lat": 12.9941, "lon": 80.1709, "category": "airport", "state": "Tamil Nadu", "region_id": "chennai"},
    {"name": "Sriharikota (ISRO Satish Dhawan Space Centre / DWR)", "lat": 13.7199, "lon": 80.2304, "category": "radar_station", "state": "Andhra Pradesh", "region_id": "chennai"},
    {"name": "Tambaram & Chromepet, South Chennai", "lat": 12.9249, "lon": 80.1000, "category": "locality", "state": "Tamil Nadu", "region_id": "chennai"},
    {"name": "Sriperumbudur & Oragadam Auto Hub", "lat": 12.9703, "lon": 79.9431, "category": "city", "state": "Tamil Nadu", "region_id": "chennai"},
    {"name": "Kanchipuram Temple Town", "lat": 12.8342, "lon": 79.7036, "category": "city", "state": "Tamil Nadu", "region_id": "chennai"},
    {"name": "Mahabalipuram (Shore Temple)", "lat": 12.6269, "lon": 80.1927, "category": "landmark", "state": "Tamil Nadu", "region_id": "chennai"},
    {"name": "Vellore & Katpadi", "lat": 12.9165, "lon": 79.1325, "category": "city", "state": "Tamil Nadu", "region_id": "chennai"},
    {"name": "Tirupati & Tirumala Hills", "lat": 13.6288, "lon": 79.4192, "category": "city", "state": "Andhra Pradesh", "region_id": "chennai"},
    {"name": "Nellore Coast", "lat": 14.4426, "lon": 79.9865, "category": "city", "state": "Andhra Pradesh", "region_id": "chennai"},
    {"name": "Puducherry (Pondicherry French Quarter)", "lat": 11.9416, "lon": 79.8083, "category": "city", "state": "Puducherry", "region_id": "chennai"},

    # --- Guwahati & Assam / Northeast ---
    {"name": "Guwahati City Center / Pan Bazaar", "lat": 26.1856, "lon": 91.7482, "category": "city", "state": "Assam", "region_id": "guwahati"},
    {"name": "Dispur (Capital Complex / Assam Secretariat)", "lat": 26.1433, "lon": 91.7898, "category": "locality", "state": "Assam", "region_id": "guwahati"},
    {"name": "Lokpriya Gopinath Bordoloi Airport (Borjhar / DWR / GAU)", "lat": 26.1061, "lon": 91.5859, "category": "radar_station", "state": "Assam", "region_id": "guwahati"},
    {"name": "Kamakhya Temple & Nilachal Hill, Guwahati", "lat": 26.1664, "lon": 91.7052, "category": "landmark", "state": "Assam", "region_id": "guwahati"},
    {"name": "IIT Guwahati & North Guwahati (Brahmaputra)", "lat": 26.1923, "lon": 91.6961, "category": "locality", "state": "Assam", "region_id": "guwahati"},
    {"name": "Beltola & Six Mile, Guwahati", "lat": 26.1287, "lon": 91.7969, "category": "locality", "state": "Assam", "region_id": "guwahati"},
    {"name": "Shillong (Scotland of the East), Meghalaya", "lat": 25.5788, "lon": 91.8933, "category": "city", "state": "Meghalaya", "region_id": "guwahati"},
    {"name": "Cherrapunji (Sohra) / Mawsynram (Wettest Place on Earth)", "lat": 25.2702, "lon": 91.7323, "category": "landmark", "state": "Meghalaya", "region_id": "guwahati"},
    {"name": "Tezpur & Sonitpur", "lat": 26.6528, "lon": 92.7926, "category": "city", "state": "Assam", "region_id": "guwahati"},
    {"name": "Jorhat & Kaziranga National Park", "lat": 26.7509, "lon": 94.2037, "category": "city", "state": "Assam", "region_id": "guwahati"},
    {"name": "Dibrugarh & Tinsukia (Upper Assam)", "lat": 27.4728, "lon": 94.9120, "category": "city", "state": "Assam", "region_id": "guwahati"},

    # --- Bengaluru & South Karnataka ---
    {"name": "Bengaluru City / MG Road & Cubbon Park", "lat": 12.9716, "lon": 77.5946, "category": "city", "state": "Karnataka", "region_id": "bengaluru"},
    {"name": "Whitefield (ITPB / IT Corridor), Bengaluru", "lat": 12.9698, "lon": 77.7500, "category": "locality", "state": "Karnataka", "region_id": "bengaluru"},
    {"name": "Electronic City Phase 1 & 2, Bengaluru", "lat": 12.8399, "lon": 77.6770, "category": "locality", "state": "Karnataka", "region_id": "bengaluru"},
    {"name": "Koramangala & HSR Layout, Bengaluru", "lat": 12.9352, "lon": 77.6245, "category": "locality", "state": "Karnataka", "region_id": "bengaluru"},
    {"name": "Indiranagar & Domlur, Bengaluru", "lat": 12.9784, "lon": 77.6408, "category": "locality", "state": "Karnataka", "region_id": "bengaluru"},
    {"name": "Marathahalli & Bellandur Outer Ring Road, Bengaluru", "lat": 12.9345, "lon": 77.6900, "category": "locality", "state": "Karnataka", "region_id": "bengaluru"},
    {"name": "Yelahanka & Hebbal (Manyata Tech Park), Bengaluru", "lat": 13.0358, "lon": 77.5970, "category": "locality", "state": "Karnataka", "region_id": "bengaluru"},
    {"name": "Kempegowda International Airport (BLR / Devanahalli)", "lat": 13.1986, "lon": 77.7066, "category": "airport", "state": "Karnataka", "region_id": "bengaluru"},
    {"name": "IMD Bengaluru Observatory (DWR Station)", "lat": 12.9600, "lon": 77.5800, "category": "radar_station", "state": "Karnataka", "region_id": "bengaluru"},
    {"name": "Jayanagar & JP Nagar, South Bengaluru", "lat": 12.9308, "lon": 77.5838, "category": "locality", "state": "Karnataka", "region_id": "bengaluru"},
    {"name": "Malleshwaram & Rajajinagar, West Bengaluru", "lat": 13.0031, "lon": 77.5643, "category": "locality", "state": "Karnataka", "region_id": "bengaluru"},
    {"name": "Mysuru (Mysore Palace / Chamundi Hills)", "lat": 12.2958, "lon": 76.6394, "category": "city", "state": "Karnataka", "region_id": "bengaluru"},
    {"name": "Tumakuru (Tumkur)", "lat": 13.3379, "lon": 77.1010, "category": "city", "state": "Karnataka", "region_id": "bengaluru"},
    {"name": "Hosur Industrial Belt", "lat": 12.7409, "lon": 77.8253, "category": "city", "state": "Tamil Nadu", "region_id": "bengaluru"},
    {"name": "Mangaluru Coast (Mangalore Port)", "lat": 12.9141, "lon": 74.8560, "category": "city", "state": "Karnataka", "region_id": "bengaluru"},

    # --- Other Major Indian Cities & Convective Zones ---
    {"name": "Ahmedabad & Gandhinagar (GIFT City)", "lat": 23.0225, "lon": 72.5714, "category": "city", "state": "Gujarat", "region_id": "mumbai"},
    {"name": "Jaipur (Pink City)", "lat": 26.9124, "lon": 75.7873, "category": "city", "state": "Rajasthan", "region_id": "delhi"},
    {"name": "Lucknow (Nawab City)", "lat": 26.8467, "lon": 80.9462, "category": "city", "state": "Uttar Pradesh", "region_id": "delhi"},
    {"name": "Varanasi (Kashi / Banaras Ghats)", "lat": 25.3176, "lon": 82.9739, "category": "city", "state": "Uttar Pradesh", "region_id": "kolkata"},
    {"name": "Patna (Bihar Capital)", "lat": 25.5941, "lon": 85.1376, "category": "city", "state": "Bihar", "region_id": "kolkata"},
    {"name": "Visakhapatnam (Vizag Port & Smart City)", "lat": 17.6868, "lon": 83.2185, "category": "city", "state": "Andhra Pradesh", "region_id": "bhubaneswar"},
    {"name": "Vijayawada & Amaravati", "lat": 16.5062, "lon": 80.6480, "category": "city", "state": "Andhra Pradesh", "region_id": "hyderabad"},
    {"name": "Kochi & Ernakulam (Marine Drive), Kerala", "lat": 9.9312, "lon": 76.2673, "category": "city", "state": "Kerala", "region_id": "bengaluru"},
    {"name": "Thiruvananthapuram (Trivandrum / VSSC)", "lat": 8.5241, "lon": 76.9366, "category": "city", "state": "Kerala", "region_id": "chennai"},
    {"name": "Indore (Pithampur IT Hub)", "lat": 22.7196, "lon": 75.8577, "category": "city", "state": "Madhya Pradesh", "region_id": "mumbai"},
    {"name": "Bhopal (Lake City)", "lat": 23.2599, "lon": 77.4126, "category": "city", "state": "Madhya Pradesh", "region_id": "delhi"},
    {"name": "Nagpur (Zero Mile / Orange City)", "lat": 21.1458, "lon": 79.0882, "category": "city", "state": "Maharashtra", "region_id": "hyderabad"},
    {"name": "Chandigarh Capital Complex (Tricity)", "lat": 30.7333, "lon": 76.7794, "category": "city", "state": "Punjab / Haryana", "region_id": "delhi"},
    {"name": "Coimbatore & Nilgiris (Ooty)", "lat": 11.0168, "lon": 76.9558, "category": "city", "state": "Tamil Nadu", "region_id": "bengaluru"},
    {"name": "Madurai (Meenakshi Temple)", "lat": 9.9252, "lon": 78.1198, "category": "city", "state": "Tamil Nadu", "region_id": "chennai"},
    {"name": "Ranchi (Jharkhand Capital)", "lat": 23.3441, "lon": 85.3096, "category": "city", "state": "Jharkhand", "region_id": "kolkata"},
    {"name": "Raipur & Naya Raipur (Chhattisgarh)", "lat": 21.2514, "lon": 81.6296, "category": "city", "state": "Chhattisgarh", "region_id": "bhubaneswar"},
    {"name": "Dehradun & Mussoorie", "lat": 30.3165, "lon": 78.0322, "category": "city", "state": "Uttarakhand", "region_id": "delhi"},
    {"name": "Srinagar (Dal Lake), Kashmir", "lat": 34.0837, "lon": 74.7973, "category": "city", "state": "Jammu & Kashmir", "region_id": "delhi"}
]


def haversine_distance_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Calculate great-circle distance between two GPS coordinates in kilometers."""
    R = 6371.0  # Earth's radius in km
    phi1 = math.radians(lat1)
    phi2 = math.radians(lat2)
    delta_phi = math.radians(lat2 - lat1)
    delta_lambda = math.radians(lon2 - lon1)

    a = (math.sin(delta_phi / 2.0) ** 2 +
         math.cos(phi1) * math.cos(phi2) * (math.sin(delta_lambda / 2.0) ** 2))
    c = 2.0 * math.atan2(math.sqrt(a), math.sqrt(1.0 - a))
    return R * c


def find_nearest_radar_region(lat: float, lon: float) -> Tuple[str, str, float]:
    """Find the nearest Doppler Weather Radar station and region ID to any coordinates.
    
    Returns:
        (region_id, radar_station_name, distance_km)
    """
    best_region_id = "hyderabad"
    best_station = REGIONS["hyderabad"]["dwr_station"]
    min_dist = float("inf")

    for r_id, r_info in REGIONS.items():
        c_lat, c_lon = r_info["center"]
        dist = haversine_distance_km(lat, lon, c_lat, c_lon)
        if dist < min_dist:
            min_dist = dist
            best_region_id = r_id
            best_station = r_info["dwr_station"]

    return best_region_id, best_station, round(min_dist, 1)


def parse_coordinate_query(query: str) -> Optional[Tuple[float, float]]:
    """Attempt to parse coordinate pair like '17.44, 78.34' or '17.44 78.34'."""
    q = query.strip()
    if not q:
        return None
    try:
        parts = [p.strip() for p in q.replace(",", " ").split() if p.strip()]
        if len(parts) == 2:
            lat = float(parts[0])
            lon = float(parts[1])
            # Basic sanity check for valid latitude / longitude
            if -90.0 <= lat <= 90.0 and -180.0 <= lon <= 180.0:
                return lat, lon
    except ValueError:
        pass
    return None


def search_locations(query: str, limit: int = 10) -> List[LocationSearchResult]:
    """Search pre-indexed Indian localities, cities, airports, and landmarks with fuzzy matching."""
    q = query.strip().lower()
    if not q:
        return []

    # 1. Check if user entered direct GPS coordinates
    coord = parse_coordinate_query(query)
    results: List[LocationSearchResult] = []
    
    if coord:
        c_lat, c_lon = coord
        r_id, station, dist_km = find_nearest_radar_region(c_lat, c_lon)
        results.append(LocationSearchResult(
            name=f"GPS Coordinates ({c_lat:.4f}°, {c_lon:.4f}°)",
            lat=c_lat,
            lon=c_lon,
            category="coordinate",
            state="Custom Coordinates",
            nearest_region_id=r_id,
            nearest_radar_station=station,
            distance_to_radar_km=dist_km
        ))

    # 2. Match in local Indian database
    query_tokens = [t for t in q.replace(",", " ").replace("-", " ").split() if t]
    
    scored_items: List[Tuple[float, Dict[str, Any]]] = []
    for item in INDIAN_LOCATIONS:
        name_lower = item["name"].lower()
        state_lower = item.get("state", "").lower()
        category_lower = item.get("category", "").lower()
        full_text = f"{name_lower} {state_lower} {category_lower}"

        # Exact start match
        if name_lower.startswith(q):
            score = 100.0
        elif q in name_lower:
            score = 80.0
        else:
            # Token match
            matched_tokens = sum(1 for t in query_tokens if t in full_text)
            if matched_tokens == len(query_tokens):
                score = 60.0 + matched_tokens * 5
            elif matched_tokens > 0:
                score = 30.0 + (matched_tokens / len(query_tokens)) * 25
            else:
                score = 0.0

        if score > 0:
            scored_items.append((score, item))

    # Sort descending by match score
    scored_items.sort(key=lambda x: x[0], reverse=True)

    for _, item in scored_items[:limit]:
        r_id, station, dist_km = find_nearest_radar_region(item["lat"], item["lon"])
        results.append(LocationSearchResult(
            name=item["name"],
            lat=item["lat"],
            lon=item["lon"],
            category=item.get("category", "locality"),
            state=item.get("state"),
            nearest_region_id=r_id,
            nearest_radar_station=station,
            distance_to_radar_km=dist_km
        ))

    # 3. If fewer than limit results, query OpenWeatherMap Live Geocoding API
    if len(results) < limit:
        try:
            owm_results = search_openweather_locations(query, limit=limit - len(results))
            existing_names = {r.name.lower() for r in results}
            for item in owm_results:
                if item["name"].lower() not in existing_names:
                    r_id, station, dist_km = find_nearest_radar_region(item["lat"], item["lon"])
                    results.append(LocationSearchResult(
                        name=item["name"],
                        lat=item["lat"],
                        lon=item["lon"],
                        category="city",
                        state=item.get("state") or item.get("country", "India"),
                        nearest_region_id=r_id,
                        nearest_radar_station=station,
                        distance_to_radar_km=dist_km
                    ))
        except Exception as e:
            print(f"[OWM Geocode integration] {e}")

    return results[:limit]


def assess_area_threat(
    lat: float,
    lon: float,
    time_offset_min: int = 0,
    region_id: Optional[str] = None,
    location_name: Optional[str] = None
) -> AreaThreatAssessment:
    """Calculate pinpoint nowcast threat assessment and local meteorological metrics for any location."""
    # 1. Reverse geocode location name if generic or not supplied
    resolved_name = location_name
    if not resolved_name or resolved_name.startswith("Coordinates (") or resolved_name.startswith("GPS Coordinates"):
        try:
            rev_info = reverse_geocode_location(lat, lon)
            if rev_info and rev_info.get("name"):
                resolved_name = rev_info["name"]
        except Exception as e:
            print(f"[Reverse geocode] {e}")

    # Determine nearest region
    if not region_id or region_id not in REGIONS:
        nearest_r_id, station_name, dist_radar_km = find_nearest_radar_region(lat, lon)
    else:
        nearest_r_id = region_id
        station_name = REGIONS[region_id]["dwr_station"]
        c_lat, c_lon = REGIONS[region_id]["center"]
        dist_radar_km = round(haversine_distance_km(lat, lon, c_lat, c_lon), 1)

    # 2. Fetch Live In-Situ Observations from OpenWeatherMap
    live_weather_obj: Optional[LiveWeatherObservation] = None
    try:
        live_data = fetch_live_weather(lat, lon)
        if live_data:
            live_weather_obj = LiveWeatherObservation(**live_data)
            if not resolved_name or resolved_name.startswith("Coordinates ("):
                if live_data.get("city_name"):
                    resolved_name = f"{live_data['city_name']}, India"
    except Exception as e:
        print(f"[OWM live weather fetch] {e}")

    if not resolved_name:
        resolved_name = f"Coordinates ({lat:.4f}°, {lon:.4f}°)"

    # 3. Sample Radar Reflectivity & Cloud Top Temperature
    region_info = REGIONS[nearest_r_id]
    min_lat, min_lon, max_lat, max_lon = region_info["bounds"]

    radar_grid, sat_grid, cells_meta = generate_spatiotemporal_grid(nearest_r_id, time_offset_min)
    rows, cols = radar_grid.shape

    is_within_radar_grid = (min_lat <= lat <= max_lat and min_lon <= lon <= max_lon and dist_radar_km <= 150.0)

    if is_within_radar_grid:
        r_idx = int(np.clip(((lat - min_lat) / (max_lat - min_lat)) * (rows - 1), 0, rows - 1))
        c_idx = int(np.clip(((lon - min_lon) / (max_lon - min_lon)) * (cols - 1), 0, cols - 1))
        local_dbz = float(radar_grid[r_idx, c_idx])
        local_ctt = float(sat_grid[r_idx, c_idx])
    else:
        # Outside active DWR radar coverage (>150km away)
        # Derive ground truth from live OpenWeatherMap observation
        if live_weather_obj and live_weather_obj.rain_1h_mm > 0.1:
            r_mm = live_weather_obj.rain_1h_mm
            # Z = 200 * R^1.6 -> dBZ = 10 * log10(200 * R^1.6)
            local_dbz = round(min(65.0, max(18.0, 10.0 * math.log10(200.0 * (r_mm ** 1.6)))), 1)
        elif live_weather_obj and "thunderstorm" in live_weather_obj.condition.lower():
            local_dbz = 45.0
        elif live_weather_obj and ("rain" in live_weather_obj.condition.lower() or "drizzle" in live_weather_obj.condition.lower()):
            local_dbz = 28.0
        else:
            local_dbz = 0.0

        if live_weather_obj:
            # Estimate cloud top temp from surface temperature & cloud cover
            cov = live_weather_obj.cloud_coverage_pct / 100.0
            local_ctt = round(live_weather_obj.temperature_c - (cov * 35.0), 1)
        else:
            local_ctt = 22.0

    # Marshall-Palmer Z-R rain rate: Z = 200 * R^1.6 -> R = (10^(dBZ/10) / 200)^(1/1.6)
    if local_dbz > 15.0:
        z_linear = 10.0 ** (local_dbz / 10.0)
        rain_rate = (z_linear / 200.0) ** (1.0 / 1.6)
    elif live_weather_obj and live_weather_obj.rain_1h_mm > 0:
        rain_rate = live_weather_obj.rain_1h_mm
    else:
        rain_rate = 0.0

    # 4. Nearest Storm Cell Analysis (Only relevant within 60 km)
    nearest_cell_id: Optional[str] = None
    min_cell_dist_km: Optional[float] = None
    is_approaching = False
    estimated_eta_min: Optional[int] = None

    if cells_meta and dist_radar_km <= 160.0:
        cell = cells_meta[0]
        c_lat = cell["lat"]
        c_lon = cell["lon"]
        d_cell = haversine_distance_km(lat, lon, c_lat, c_lon)

        # Only link storm cell if within reasonable tracking horizon (<= 60 km)
        if d_cell <= 60.0:
            nearest_cell_id = cell["cell_id"]
            min_cell_dist_km = round(d_cell, 1)

            heading_rad = math.radians(cell["heading_deg"])
            v_lat = math.cos(heading_rad)
            v_lon = math.sin(heading_rad)
            t_lat = lat - c_lat
            t_lon = lon - c_lon
            dot_product = (v_lat * t_lat) + (v_lon * t_lon)

            if dot_product > 0 and d_cell > 2.0:
                is_approaching = True
                speed_km_min = max(0.2, cell["speed_kmh"] / 60.0)
                eta = int(d_cell / speed_km_min)
                if eta <= 120:
                    estimated_eta_min = eta

    # 5. Lightning Strikes (within 15km)
    if is_within_radar_grid and cells_meta:
        base_cell_lat = cells_meta[0]["lat"]
        base_cell_lon = cells_meta[0]["lon"]
        strikes = get_simulated_lightning_strikes(nearest_r_id, time_offset_min, base_cell_lat, base_cell_lon, local_dbz + 10.0)
        local_strikes_15km = sum(
            1 for s in strikes if haversine_distance_km(lat, lon, s.lat, s.lon) <= 15.0
        )
    elif live_weather_obj and "thunderstorm" in live_weather_obj.condition.lower():
        local_strikes_15km = 4
    else:
        local_strikes_15km = 0

    # 6. Categorize Threat Level and Life-Safety Directives
    if local_dbz >= 50.0 or (min_cell_dist_km is not None and min_cell_dist_km < 8.0 and local_dbz >= 40.0) or local_strikes_15km >= 8:
        threat_level = "Severe"
        threat_score = min(99, int(75 + (local_dbz - 45) * 1.5 + local_strikes_15km * 2))
        safety = "DANGER: Severe convective storm core over or directly adjacent to this area. High frequency cloud-to-ground lightning, violent wind gusts, and localized flash pooling likely. Seek immediate sturdy shelter indoors. Avoid open terraces and trees."
    elif local_dbz >= 36.0 or (min_cell_dist_km is not None and min_cell_dist_km < 20.0 and is_approaching) or local_strikes_15km >= 3:
        threat_level = "High"
        threat_score = min(85, int(50 + (local_dbz - 30) * 1.2 + (20 - min(20, min_cell_dist_km or 20))))
        safety = "WARNING: Moderate to heavy thunderstorm approaching this area within 15-45 minutes. Cloud-to-ground lightning and brief gale gusts probable. Postpone outdoor operations and secure loose objects."
    elif local_dbz >= 20.0 or (min_cell_dist_km is not None and min_cell_dist_km < 40.0) or (live_weather_obj and ("rain" in live_weather_obj.condition.lower() or "drizzle" in live_weather_obj.condition.lower())):
        threat_level = "Moderate"
        threat_score = min(55, int(25 + local_dbz * 0.7))
        safety = "ADVISORY: Developing convective cloudiness or localized precipitation in the vicinity. Monitor radar updates and keep umbrella accessible."
    else:
        threat_level = "Low"
        threat_score = max(5, int(local_dbz * 0.5))
        safety = "STABLE: Atmospherically stable conditions at this location. No severe convective storms or lightning detected in immediate vicinity."

    return AreaThreatAssessment(
        query_lat=round(lat, 4),
        query_lon=round(lon, 4),
        location_name=resolved_name,
        time_offset_min=time_offset_min,
        nearest_region_id=nearest_r_id,
        nearest_radar_station=station_name,
        distance_to_radar_km=dist_radar_km,
        local_dbz=round(local_dbz, 1),
        local_cloud_top_temp_c=round(local_ctt, 1),
        estimated_rain_rate_mmh=round(rain_rate, 1),
        threat_level=threat_level,
        threat_score_pct=threat_score,
        nearest_cell_id=nearest_cell_id,
        distance_to_nearest_cell_km=min_cell_dist_km,
        nearest_cell_approaching=is_approaching,
        estimated_cell_eta_minutes=estimated_eta_min,
        lightning_strikes_15km=local_strikes_15km,
        safety_directive=safety,
        live_weather=live_weather_obj
    )

