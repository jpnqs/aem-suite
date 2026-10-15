# Shared terragrunt config: local state + solacebroker provider pointed at SEMP.

remote_state {
  backend = "local"
  generate = {
    path      = "backend.tf"
    if_exists = "overwrite_terragrunt"
  }
  config = {
    path = "${get_parent_terragrunt_dir()}/.state/${path_relative_to_include()}/terraform.tfstate"
  }
}

generate "provider" {
  path      = "provider.tf"
  if_exists = "overwrite_terragrunt"
  contents  = <<-EOF
    provider "solacebroker" {
      url      = "${get_env("SOLACE_SEMP_URL", "http://localhost:8080")}"
      username = "${get_env("SOLACE_SEMP_USERNAME", "admin")}"
      password = "${get_env("SOLACE_SEMP_PASSWORD", "admin")}"
    }
  EOF
}
