$targetDir = "C:\Users\chris\Desktop\adamic\.agents\workflows"
$workflows = Get-ChildItem -Path $targetDir -Filter *.md

$results = @()

foreach ($wf in $workflows) {
    $content = Get-Content $wf.FullName -Raw
    $lines = ($content -split "`n").Count
    $hasDesc = $content -match "description:.*"
    $descMatches = [regex]::Match($content, 'description:\s*\|?([^#]*)---', [System.Text.RegularExpressions.RegexOptions]::Singleline)
    $desc = if ($descMatches.Success) { $descMatches.Groups[1].Value.Trim() -replace "`r", "" -replace "`n", " " } else { "None" }
    $descWords = ($desc -split "\s+").Count
    
    $obj = [PSCustomObject]@{
        Name = $wf.BaseName
        Lines = $lines
        HasDesc = $hasDesc
        DescWords = $descWords
        DescPreview = if ($desc.Length -gt 150) { $desc.Substring(0, 150) + "..." } else { $desc }
    }
    $results += $obj
}

$results | ConvertTo-Json -Depth 2
