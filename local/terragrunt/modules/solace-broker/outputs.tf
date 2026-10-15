output "msg_vpn_name" {
  value = solacebroker_msg_vpn.this.msg_vpn_name
}

output "client_usernames" {
  value = keys(var.users)
}

output "queues" {
  value = { for name, q in var.queues : name => q.subscriptions }
}
