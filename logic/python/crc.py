import binascii

"""
Validate CRC32 checksum of the data by extracting the last 4 bytes of the data
and comparing it with the calculated CRC32 checksum of the data excluding
the last 4 bytes (CRC).
"""
def validate_crc(data):
    source_crc = int.from_bytes(bytes(data[-4:]), 'big')
    return source_crc == binascii.crc32(bytes(data[:-4]))
