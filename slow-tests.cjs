const fs = require('fs');

let input = fs.readFileSync('test-output.json');
// Detect UTF-16LE BOM
if (input[0] === 0xFF && input[1] === 0xFE) {
    input = input.toString('utf16le');
} else {
    input = input.toString('utf8');
}

const data = JSON.parse(input);
const files = data.testResults.map(r => {
    return { name: r.name.split('/').pop(), duration: r.endTime - r.startTime };
});
files.sort((a, b) => b.duration - a.duration);

const tests = [];
data.testResults.forEach(r => {
    r.assertionResults.forEach(a => {
        tests.push({
            name: a.title,
            file: r.name.split('/').pop(),
            duration: a.duration
        });
    });
});
tests.sort((a, b) => b.duration - a.duration);

console.log('--- Top 5 Slowest Files ---');
files.slice(0, 5).forEach(f => console.log(`${f.duration}ms - ${f.name}`));

console.log('\n--- Top 5 Slowest Tests ---');
tests.slice(0, 5).forEach(t => console.log(`${t.duration}ms - [${t.file}] ${t.name}`));
