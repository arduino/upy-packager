import io, deflate, os

def file_or_dir_exists(filename):
    try:
        os.stat(filename)
        return True
    except OSError:
        return False

def decompress_data(data):
    f = io.BytesIO(data)
    with deflate.DeflateIO(f) as g:
        return g.read()

def decompress_file(file_path):
    with open(file_path, 'rb') as f:
        compressed_data = f.read()
        data = decompress_data(compressed_data)
        
        # Write contents to a tar file
        target_file = file_path.replace('.gz', '')
        with open(target_file, 'wb') as g:
            g.write(data)

        return target_file

def untar(file_path, target_dir = "lib", cleanup = True):
    # Ensure target_dir exists
    if not file_or_dir_exists(target_dir):
        raise Exception(f"{target_dir} directory does not exist")

    if file_path.endswith('.gz'):
        uncompressed_file = decompress_file(file_path)
    else:
        uncompressed_file = file_path
    
    archive = TarFile(uncompressed_file)

    for entry in archive:
        entry_name = entry.name
        entry_type = entry.type

        # Skip . and ./ directories
        if entry_type == DIRTYPE and (entry_name == "." or entry_name == "./"):
            continue

        # Strip leading "./" or "/"
        if entry_name.startswith("./"):
            entry_name = entry_name[2:]
        if entry_name.startswith("/"):
            entry_name = entry_name[1:]

        # Prepend target directory
        entry_name = target_dir + "/" + entry_name

        if entry_type == DIRTYPE:
            # Strip trailing slash
            if entry_name.endswith("/"):
                entry_name = entry_name[:-1]
            print("Creating directory", entry_name)
            os.mkdir(entry_name)
        else:
            print("Extracting file", entry_name)
            f = archive.extractfile(entry)
            with open(entry_name, "wb") as of:
                of.write(f.read())
            
    archive.close()
    if cleanup:
        os.remove(uncompressed_file)
