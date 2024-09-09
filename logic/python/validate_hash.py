from hashlib import sha256
from binascii import hexlify

def validate_hash(target_file, local_file_hash, chunk_size = 512):
  hash = sha256()

  with open(target_file, 'rb') as f:  
    
    while True:        
      data = f.read(chunk_size)            
      if len(data) == 0:
        break      
      hash.update(data)

  digest_hex = hexlify(hash.digest())  

  if digest_hex == local_file_hash:
    print('1')
  else:
    print('0')