---
name: gcp
description: |
  Google Cloud Platform (GCP) best practices. Use when provisioning GCP infrastructure, configuring IAM, deploying to Cloud Run, GKE (Kubernetes Engine), Cloud Functions, Cloud SQL, or managing BigQuery.
---

# Google Cloud Platform (GCP) Best Practices

**STOP.** Your knowledge of GCP may be outdated. Prefer retrieval over pre-training for any version-sensitive GCP configuration. Fetch current documentation when in doubt.

Guidelines for architecting and deploying secure, scalable applications on GCP.

## 1. Identity and Access Management (IAM)

- **Service Accounts**: Do not use the default Compute Engine service account. Create dedicated, narrowly-scoped service accounts for each application (Cloud Run, GKE node pool, Cloud Function).
- **Workload Identity**: Always use Workload Identity (for GKE) or Workload Identity Federation (for GitHub Actions/CI) instead of generating and storing long-lived JSON service account keys.
- **Least Privilege**: Grant roles at the lowest level possible (Resource level > Project level > Folder level).

## 2. Serverless (Cloud Run & Cloud Functions)

- **Cloud Run**: Prefer Cloud Run over Cloud Functions for containerized applications. It supports multi-concurrency (handling multiple requests per instance), which significantly lowers costs and cold starts.
- **Scaling**: Configure minimum instances (`min-instances`) to 1 or more for latency-sensitive applications to mitigate cold starts. Ensure `max-instances` is set to prevent runaway billing.

## 3. Data and Storage (Cloud SQL, Cloud Storage, BigQuery)

- **Cloud SQL**: Use private IPs for Cloud SQL instances. Connect to them using the Cloud SQL Auth Proxy or Serverless VPC Access connectors rather than exposing them to the public internet.
- **Cloud Storage**: Enforce Uniform Bucket-Level Access to manage permissions solely via IAM, disabling legacy ACLs. Enable object versioning for critical buckets to protect against accidental overwrites/deletes.
- **BigQuery**: Always partition and cluster large BigQuery tables to minimize query costs (BigQuery charges per byte processed).

## 4. Networking and Security

- **VPC Service Controls**: Use VPC SC to create secure perimeters around sensitive data (e.g., preventing data exfiltration from Cloud Storage or BigQuery).
- **Cloud Armor**: Attach Google Cloud Armor to Global HTTP(S) Load Balancers to defend against DDoS attacks and implement WAF (Web Application Firewall) rules.

## 5. Infrastructure as Code

- **Terraform**: Use Terraform as the primary IaC tool for GCP. Store the Terraform state in a centralized, version-enabled Cloud Storage bucket with state locking enabled.
