param (
    [Parameter(Mandatory=$false)]
    [string]$TargetSkill = ""
)

# Resolve the skills root directory
$skillsDir = Resolve-Path "$PSScriptRoot\..\.."

# Ensure gh CLI is available
if (-not (Get-Command "gh" -ErrorAction SilentlyContinue)) {
    Write-Error "GitHub CLI (gh) is required but not installed."
    exit 1
}

# Determine which skills to run against
if ($TargetSkill) {
    $targetPath = Join-Path $skillsDir $TargetSkill
    if (-not (Test-Path $targetPath)) {
        Write-Error "Skill directory '$TargetSkill' not found in $skillsDir"
        exit 1
    }
    $skills = @(Get-Item $targetPath)
} else {
    $skills = Get-ChildItem -Path $skillsDir -Directory | Where-Object Name -notin 'bin', 'node_modules', '.git', '.agents'
}

foreach ($skill in $skills) {
    $skillFile = Join-Path $skill.FullName "SKILL.md"
    if (Test-Path $skillFile) {
        Write-Host "==========================================" -ForegroundColor Cyan
        Write-Host "Validating: $($skill.Name)" -ForegroundColor Cyan
        Write-Host "==========================================" -ForegroundColor Cyan
        
        $content = Get-Content $skillFile -Raw
        
        $prompt = "You are an expert in AI agent instruction design. Review this agent skill file for quality. `n"
        $prompt += "Evaluate it on:`n1. Trigger reliability`n2. Instruction clarity`n3. Completeness`n4. Token efficiency`n5. Security`n`n"
        $prompt += "File: $($skill.Name)/SKILL.md`n`n"
        $prompt += $content
        $prompt += "`n`nOutput a Markdown table with columns: #, Category, Severity, Finding, Suggestion."
        
        # Trim prompt to avoid max command line length issues (approx 8191 chars on Windows)
        $maxLength = 7800
        if ($prompt.Length -gt $maxLength) {
            $prompt = $prompt.Substring(0, $maxLength) + "`n... [CONTENT TRUNCATED FOR LENGTH]"
        }
        
        # Execute gh copilot in non-interactive mode with -p
        gh copilot -s -p $prompt
        Write-Host "`n"
    }
}
