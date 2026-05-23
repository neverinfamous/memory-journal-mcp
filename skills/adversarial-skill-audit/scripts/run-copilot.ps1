$skills = @("rust", "wrangler", "sqlite", "next-upgrade", "shadcn-ui", "typescript", "mcp-builder", "skill-builder", "next-cache-components")

$prompt = "You are an expert in AI agent instruction design. Review these agent skill files for quality. Each skill is a markdown file with YAML frontmatter that controls when an AI agent loads it, and a body of instructions the agent follows.`n`n"
$prompt += "Evaluate each skill on:`n1. Trigger reliability`n2. Instruction clarity`n3. Completeness`n4. Token efficiency`n5. Security`n`nHere are the skill files:`n`n"

foreach ($s in $skills) {
    $f = "C:\Users\chris\Desktop\memory-journal-mcp\skills\$s\SKILL.md"
    if (Test-Path $f) {
        $prompt += "=== $f ===`n"
        $prompt += (Get-Content $f -TotalCount 80 | Out-String)
        $prompt += "`n"
    }
}

$prompt += "Output a Markdown table with columns: #, Skill, Category, Severity, Finding, Suggestion."

Write-Output $prompt | copilot
