$targetDir = "C:\Users\chris\Desktop\memory-journal-mcp\skills"
$skills = Get-ChildItem -Path $targetDir -Directory | Where-Object Name -notin 'bin', 'node_modules', '.git', 'tmp_check_skills.ps1'

$results = @()

foreach ($skill in $skills) {
    $skillFile = Join-Path $skill.FullName "SKILL.md"
    if (Test-Path $skillFile) {
        $content = Get-Content $skillFile -Raw
        $lines = ($content -split "`n").Count
        $hasName = $content -match "name:.*"
        $hasDesc = $content -match "description:.*"
        $descMatches = [regex]::Match($content, 'description:\s*\|?([^#]*)---', [System.Text.RegularExpressions.RegexOptions]::Singleline)
        $desc = if ($descMatches.Success) { $descMatches.Groups[1].Value.Trim() -replace "`r", "" -replace "`n", " " } else { "None" }
        $descWords = ($desc -split "\s+").Count
        
        $obj = [PSCustomObject]@{
            Name = $skill.Name
            Lines = $lines
            HasName = $hasName
            HasDesc = $hasDesc
            DescWords = $descWords
            DescPreview = if ($desc.Length -gt 150) { $desc.Substring(0, 150) + "..." } else { $desc }
        }
        $results += $obj
    } else {
        $results += [PSCustomObject]@{
            Name = $skill.Name
            Lines = 0
            HasName = $false
            HasDesc = $false
            DescWords = 0
            DescPreview = "MISSING SKILL.md"
        }
    }
}

$results | ConvertTo-Json -Depth 2
