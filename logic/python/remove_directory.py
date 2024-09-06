from micropython import const
import os
_S_IFDIR = const(0o040000)
_S_IFMT = const(0o170000)

def is_directory(directory):
    try:
        result = os.stat(directory)
        return result.st_mode & _S_IFMT == _S_IFDIR
    except OSError:
        return False

def remove_directory_recursive(directory):
    for item in os.listdir(directory):
        full_path = directory + "/" + item
        if is_directory(full_path):
            remove_directory_recursive(full_path)
        else:
            print("Removing file:", full_path)
            os.remove(full_path)
    print("Removing directory:", directory)
    os.rmdir(directory)
