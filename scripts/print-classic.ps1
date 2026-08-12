<#
.SYNOPSIS
  Imprime un archivo de texto replicando el comportamiento del CBSprint.exe
  original (VB.NET): render GDI+ vía PrintDocument + DrawString con fuente
  TrueType, enviado a través del driver de Windows.

.DESCRIPTION
  Equivale a la clase clsPrintManagement del proyecto VB:
    - Graphics.PageUnit = Millimeter
    - margen superior 3 mm, margen izquierdo 0
    - corte de línea DURO a MaxChars (sin word-wrap), igual que drawLines()
    - una línea en blanco al final (drawBlankLine())
  Solo envía el trabajo al spooler, por lo que funciona desde un Windows
  Service (Session 0 / LocalSystem).

.EXAMPLE
  powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -File print-classic.ps1 `
    -FilePath C:\tmp\rec.txt -PrinterName "EPSON TM-U950" `
    -FontName "Courier New" -FontSize 9 -Bold -MaxChars 40 -Encoding 1252 -Copies 1
#>

param(
    [Parameter(Mandatory = $true)]
    [string]$FilePath,

    [Parameter(Mandatory = $true)]
    [string]$PrinterName,

    [string]$FontName = 'Courier New',
    [int]$FontSize = 9,
    [switch]$Bold,
    [int]$MaxChars = 40,
    [int]$Encoding = 1252,
    [int]$Copies = 1
)

$ErrorActionPreference = 'Stop'

if (-not (Test-Path -LiteralPath $FilePath)) {
    throw "El archivo '$FilePath' no existe."
}

if ($MaxChars -lt 1) { $MaxChars = 40 }
if ($Copies -lt 1)   { $Copies = 1 }

$source = @'
using System;
using System.Drawing;
using System.Drawing.Printing;
using System.IO;
using System.Text;

public class ClassicPrintDocument : PrintDocument
{
    private readonly string _filePath;
    private readonly string _fontName;
    private readonly float _fontSize;
    private readonly bool _bold;
    private readonly int _maxChars;
    private readonly int _codepage;
    private const float TopMargin = 3f;
    private const float LeftMargin = 0f;

    public ClassicPrintDocument(string filePath, string fontName, float fontSize, bool bold, int maxChars, int codepage)
    {
        _filePath = filePath;
        _fontName = fontName;
        _fontSize = fontSize;
        _bold = bold;
        _maxChars = maxChars;
        _codepage = codepage;
    }

    protected override void OnPrintPage(PrintPageEventArgs e)
    {
        e.Graphics.PageUnit = GraphicsUnit.Millimeter;

        Font printFont;
        try
        {
            FontStyle style = _bold ? FontStyle.Bold : FontStyle.Regular;
            printFont = new Font(_fontName, _fontSize, style);
        }
        catch
        {
            printFont = new Font("Courier New", _fontSize, _bold ? FontStyle.Bold : FontStyle.Regular);
        }

        Encoding enc;
        try { enc = Encoding.GetEncoding(_codepage); }
        catch { enc = Encoding.Default; }

        float lineHeight = printFont.GetHeight(e.Graphics);
        int counter = 0;

        using (StreamReader reader = new StreamReader(_filePath, enc))
        {
            string line;
            while ((line = reader.ReadLine()) != null)
            {
                float y = TopMargin + counter * lineHeight;

                if (line.Length > _maxChars)
                {
                    int pos = 0;
                    while (line.Length - pos > _maxChars)
                    {
                        e.Graphics.DrawString(line.Substring(pos, _maxChars), printFont, Brushes.Black, LeftMargin, y);
                        counter++;
                        y = TopMargin + counter * lineHeight;
                        pos += _maxChars;
                    }
                    e.Graphics.DrawString(line.Substring(pos), printFont, Brushes.Black, LeftMargin, y);
                    counter++;
                }
                else
                {
                    e.Graphics.DrawString(line, printFont, Brushes.Black, LeftMargin, y);
                    counter++;
                }
            }
        }

        // drawBlankLine() del VB: una línea en blanco al final
        e.Graphics.DrawString(string.Empty, printFont, Brushes.Black, LeftMargin, TopMargin + counter * lineHeight);

        printFont.Dispose();
        e.HasMorePages = false;
    }
}
'@

Add-Type -TypeDefinition $source -ReferencedAssemblies 'System.Drawing.dll' -WarningAction SilentlyContinue

$fsArg   = [float]$FontSize
$boldArg = [bool]$Bold.IsPresent

for ($i = 1; $i -le $Copies; $i++) {
    $doc = New-Object ClassicPrintDocument -ArgumentList $FilePath, $FontName, $fsArg, $boldArg, $MaxChars, $Encoding
    $doc.PrinterSettings.PrinterName = $PrinterName
    if (-not $doc.PrinterSettings.IsValid) {
        throw "La impresora '$PrinterName' no existe o no es válida en este equipo."
    }
    $doc.DocumentName = 'Recibo'
    $doc.Print()
    $doc.Dispose()
}

Write-Output "OK"
