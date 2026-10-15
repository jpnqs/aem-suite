# Runs terragrunt in Docker against the local Solace broker.
# Usage: .\tg.ps1 plan | apply | destroy | output   (extra args are passed through)
param([Parameter(ValueFromRemainingArguments = $true)][string[]]$TgArgs)

if (-not $TgArgs) { $TgArgs = @('plan') }

docker run --rm -it `
  -v "${PSScriptRoot}:/work" `
  -w /work/local `
  -e SOLACE_SEMP_URL=http://host.docker.internal:8080 `
  -e SOLACE_SEMP_USERNAME=admin `
  -e SOLACE_SEMP_PASSWORD=admin `
  -e TF_PLUGIN_CACHE_DIR=/work/.plugin-cache `
  alpine/terragrunt:1.16.5 `
  terragrunt @TgArgs
