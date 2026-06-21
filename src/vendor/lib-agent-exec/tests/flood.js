
      setInterval(() => {
        process.stdout.write("stdout chunk\n");
        process.stderr.write("stderr chunk\n");
      }, 10);
      setTimeout(() => process.exit(0), 500);
    