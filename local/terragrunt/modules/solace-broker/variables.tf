variable "msg_vpn_name" {
  description = "Message VPN to create."
  type        = string
}

variable "max_msg_spool_usage_mb" {
  description = "Spool quota for the VPN in MB (new VPNs default to 0, which blocks guaranteed messaging)."
  type        = number
  default     = 1500
}

variable "acl_profiles" {
  description = "ACL profiles keyed by name. Topics listed are the allowed exceptions to a default-deny."
  type = map(object({
    publish_topics   = list(string)
    subscribe_topics = list(string)
  }))
}

variable "users" {
  description = "Client usernames keyed by name."
  type = map(object({
    password    = string
    acl_profile = string
  }))
}

variable "queues" {
  description = "Queues keyed by name, with their topic subscriptions."
  type = map(object({
    subscriptions          = list(string)
    owner                  = optional(string)
    access_type            = optional(string, "exclusive")
    permission             = optional(string, "consume")
    max_msg_spool_usage_mb = optional(number, 100)
  }))
  default = {}
}
