import { spawn } from 'child_process';

const longContent = "A".repeat(50000);
const request = {
  jsonrpc: "2.0",
  id: "test-id",
  method: "tools/call",
  params: {
    name: "create_entry",
    arguments: {
      title: "50k Entry",
      content: longContent,
      entry_type: "technical_note",
      project_number: 5
    }
  }
};

const child = spawn('node', ['dist/index.js'], {
  shell: true,
  env: {
    ...process.env,
    DB_PATH: "./.test-output/e2e/test-e2e.db",
    TEAM_DB_PATH: "./.test-output/e2e/test-team-e2e.db"
  }
});

let output = '';
child.stdout.on('data', (data) => {
  output += data.toString();
  try {
    const lines = output.trim().split('\n');
    for (const line of lines) {
      if (line.trim().startsWith('{')) {
        const response = JSON.parse(line);
        if (response.id === "test-id") {
          const success = response.result ? JSON.parse(response.result.content[0].text).success : false;
          console.log("Success:", success);
          child.kill();
          process.exit(0);
        }
      }
    }
  } catch(e) {}
});

child.stderr.on('data', (data) => {
  console.error(`stderr: ${data}`);
});

child.on('error', (err) => {
  console.error('Failed to start child process:', err);
});

child.stdin.write(JSON.stringify(request) + '\n');
