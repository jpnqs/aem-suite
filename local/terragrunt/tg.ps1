# Runs terragrunt in Docker against the local Solace broker.
# Usage: .\tg.ps1 plan | apply | destroy | output   (extra args are passed through)
# SOLACE_SEMP_URL / _USERNAME / _PASSWORD override the defaults (local container, admin/admin from docker-compose.yml).
param([Parameter(ValueFromRemainingArguments = $true)][string[]]$TgArgs)

if (-not $TgArgs) { $TgArgs = @('plan') }

function EnvOr([string]$name, [string]$default) {
  $value = [Environment]::GetEnvironmentVariable($name)
  if ($value) { $value } else { $default }
}

# -it only with a console (fails in CI / non-interactive shells)
$tty = @()
if (-not [Console]::IsInputRedirected) { $tty = @('-it') }

docker run --rm @tty `
  -v "${PSScriptRoot}:/work" `
  -w /work/local `
  -e "SOLACE_SEMP_URL=$(EnvOr 'SOLACE_SEMP_URL' 'http://host.docker.internal:8080')" `
  -e "SOLACE_SEMP_USERNAME=$(EnvOr 'SOLACE_SEMP_USERNAME' 'admin')" `
  -e "SOLACE_SEMP_PASSWORD=$(EnvOr 'SOLACE_SEMP_PASSWORD' 'admin')" `
  -e TF_PLUGIN_CACHE_DIR=/work/.plugin-cache `
  alpine/terragrunt:1.16.5 `
  terragrunt @TgArgs

exit $LASTEXITCODE
