from hashlib import sha256
from binascii import hexlify

hash = sha256()

with open('${targetFile}', 'rb') as f:  
    # TODO: Possibly read file in chunks  
    data = f.read()
    hash.update(data)

digest_hex = hexlify(hash.digest())

if digest_hex == b'${localFileHash}':
  print('Hash OK')
else:
  print('Hash mismatch')