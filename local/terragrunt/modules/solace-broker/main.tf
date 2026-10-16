terraform {
  required_providers {
    solacebroker = {
      source  = "SolaceProducts/solacebroker"
      version = "~> 1.0"
    }
  }
}

# Dedicated VPN so everything here can be destroyed without touching "default".
resource "solacebroker_msg_vpn" "this" {
  msg_vpn_name              = var.msg_vpn_name
  enabled                   = true
  authentication_basic_type = "internal"
  max_msg_spool_usage       = var.max_msg_spool_usage_mb
}

resource "solacebroker_msg_vpn_client_profile" "app" {
  msg_vpn_name                             = solacebroker_msg_vpn.this.msg_vpn_name
  client_profile_name                      = "app"
  allow_guaranteed_msg_send_enabled        = true
  allow_guaranteed_msg_receive_enabled     = true
  allow_guaranteed_endpoint_create_enabled = true
  allow_transacted_sessions_enabled        = true
}

# ACL profiles: deny by default, allow only the listed topics.
resource "solacebroker_msg_vpn_acl_profile" "this" {
  for_each = var.acl_profiles

  msg_vpn_name                   = solacebroker_msg_vpn.this.msg_vpn_name
  acl_profile_name               = each.key
  client_connect_default_action  = "allow"
  publish_topic_default_action   = "disallow"
  subscribe_topic_default_action = "disallow"
}

locals {
  publish_exceptions = merge([
    for profile, cfg in var.acl_profiles : {
      for topic in cfg.publish_topics : "${profile}|${topic}" => { profile = profile, topic = topic }
    }
  ]...)

  subscribe_exceptions = merge([
    for profile, cfg in var.acl_profiles : {
      for topic in cfg.subscribe_topics : "${profile}|${topic}" => { profile = profile, topic = topic }
    }
  ]...)

  queue_subscriptions = merge([
    for queue, cfg in var.queues : {
      for topic in cfg.subscriptions : "${queue}|${topic}" => { queue = queue, topic = topic }
    }
  ]...)
}

resource "solacebroker_msg_vpn_acl_profile_publish_topic_exception" "this" {
  for_each = local.publish_exceptions

  msg_vpn_name                   = solacebroker_msg_vpn.this.msg_vpn_name
  acl_profile_name               = solacebroker_msg_vpn_acl_profile.this[each.value.profile].acl_profile_name
  publish_topic_exception_syntax = "smf"
  publish_topic_exception        = each.value.topic
}

resource "solacebroker_msg_vpn_acl_profile_subscribe_topic_exception" "this" {
  for_each = local.subscribe_exceptions

  msg_vpn_name                     = solacebroker_msg_vpn.this.msg_vpn_name
  acl_profile_name                 = solacebroker_msg_vpn_acl_profile.this[each.value.profile].acl_profile_name
  subscribe_topic_exception_syntax = "smf"
  subscribe_topic_exception        = each.value.topic
}

resource "solacebroker_msg_vpn_client_username" "this" {
  for_each = var.users

  msg_vpn_name        = solacebroker_msg_vpn.this.msg_vpn_name
  client_username     = each.key
  password            = each.value.password
  enabled             = true
  acl_profile_name    = solacebroker_msg_vpn_acl_profile.this[each.value.acl_profile].acl_profile_name
  client_profile_name = solacebroker_msg_vpn_client_profile.app.client_profile_name
}

resource "solacebroker_msg_vpn_queue" "this" {
  for_each = var.queues

  msg_vpn_name        = solacebroker_msg_vpn.this.msg_vpn_name
  queue_name          = each.key
  access_type         = each.value.access_type
  permission          = each.value.permission
  owner               = each.value.owner
  max_msg_spool_usage = each.value.max_msg_spool_usage_mb
  ingress_enabled     = true
  egress_enabled      = true

  depends_on = [solacebroker_msg_vpn_client_username.this]
}

resource "solacebroker_msg_vpn_queue_subscription" "this" {
  for_each = local.queue_subscriptions

  msg_vpn_name       = solacebroker_msg_vpn.this.msg_vpn_name
  queue_name         = solacebroker_msg_vpn_queue.this[each.value.queue].queue_name
  subscription_topic = each.value.topic
}
