include "root" {
  path = find_in_parent_folders("root.hcl")
}

terraform {
  source = "../modules/solace-broker"
}

inputs = {
  msg_vpn_name = "aem-local"

  acl_profiles = {
    publisher = {
      publish_topics   = ["aem/>"]
      subscribe_topics = []
    }
    subscriber = {
      publish_topics   = []
      subscribe_topics = ["aem/>"]
    }
    full = {
      publish_topics   = [">"]
      subscribe_topics = [">"]
    }
  }

  # Local demo credentials only.
  users = {
    "aem-publisher"  = { password = "publisher", acl_profile = "publisher" }
    "aem-subscriber" = { password = "subscriber", acl_profile = "subscriber" }
    "aem-suite"      = { password = "aemsuite", acl_profile = "full" }
  }

  queues = {
    "q.aem.orders" = {
      subscriptions = ["aem/orders/>"]
      owner         = "aem-subscriber"
    }
    "q.aem.events" = {
      subscriptions = ["aem/events/>", "aem/notifications/*"]
      access_type   = "non-exclusive"
    }
    "q.aem.dlq" = {
      subscriptions = []
    }
  }
}
