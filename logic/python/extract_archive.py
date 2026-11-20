import os

_CHUNK_SIZE = const(512)

def file_or_dir_exists(filename):
    try:
        os.stat(filename)
        return True
    except OSError:
        return False

def untar(file_path, target_dir, cleanup=True):
    if not file_or_dir_exists(target_dir):
        raise Exception(f"{target_dir} directory does not exist")

    try:
        try:
            import deflate
        except ImportError:
            raise ImportError("deflate module not available. Firmware >= 1.21 required.")

        with open(file_path, 'rb') as raw:
            stream = deflate.DeflateIO(raw) if file_path.endswith('.gz') else raw
            with TarFile(fileobj=stream) as archive:
                buf = bytearray(_CHUNK_SIZE)
                for entry in archive:
                    entry_name = entry.name
                    entry_type = entry.type

                    # Skip . and ./ directories
                    if entry_type == DIRTYPE and (entry_name == "./" or entry_name == "."):
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
                            while True:
                                n = f.readinto(buf)
                                if not n:
                                    break
                                of.write(memoryview(buf)[:n])
        print("Extraction complete")
    except AttributeError as e:
        raise AttributeError(f"Streaming extraction not supported: {e}. Firmware >= 1.21 required.")
    finally:
        if cleanup:
            os.remove(file_path)
