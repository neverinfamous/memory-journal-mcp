
      const chunk = "A".repeat(1024 * 1024); // 1MB
      for (let i = 0; i < 15; i++) {
        process.stdout.write(chunk);
      }
    