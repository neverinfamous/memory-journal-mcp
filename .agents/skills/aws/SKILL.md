---
name: aws
description: |
  Comprehensive AWS (Amazon Web Services) best practices and infrastructure guidelines. Use when deploying to AWS, writing CloudFormation/CDK/Terraform for AWS, configuring IAM permissions, S3 buckets, EC2 instances, Lambda functions, or ECS/EKS clusters.
---

# Amazon Web Services (AWS) Best Practices

**STOP.** Your knowledge of AWS may be outdated. Prefer retrieval over pre-training for any version-sensitive AWS configuration. Fetch current documentation when in doubt.

Production-grade standards for designing, deploying, and managing infrastructure on AWS.

## 1. Security & IAM (Identity and Access Management)

- **Principle of Least Privilege (PoLP)**: Never use `*` (wildcard) actions or resources in IAM policies unless absolutely required (e.g., specific S3 list actions). Scope policies to specific ARNs and exact actions.
- **Root Account**: Never use the root account for day-to-day operations. Use AWS SSO (IAM Identity Center) or assume roles.
- **Secrets Management**: Never hardcode secrets in code or environment variables attached to instances. Always use **AWS Secrets Manager** or **AWS Systems Manager Parameter Store (SSM)**.

## 2. Serverless (Lambda & API Gateway)

- **Cold Starts**: Minimize cold starts in Lambda by keeping deployment packages small. For Node.js/TypeScript, use tools like `esbuild` to bundle and tree-shake code.
- **Concurrency**: Set reserved concurrency for critical functions to ensure they always have execution capacity.
- **Idempotency**: Lambda functions should be idempotent, especially when triggered by SQS, SNS, or EventBridge, as AWS guarantees at-least-once delivery (not exactly-once).

## 3. Storage & Databases (S3, DynamoDB, RDS)

- **S3 Security**: ALWAYS enable "Block Public Access" at the bucket level unless serving a static website. Enforce server-side encryption (`AES256` or `aws:kms`).
- **DynamoDB**: Prefer single-table design when access patterns are strictly known. Use On-Demand capacity for unpredictable workloads and Provisioned capacity (with Auto Scaling) for predictable workloads to save costs.
- **RDS**: Never place RDS instances in public subnets. They must reside in private subnets, accessed via Bastion Hosts, VPN, or Session Manager.

## 4. Networking (VPC)

- **Multi-AZ**: Always deploy critical resources (NAT Gateways, RDS, ALB, ECS) across at least two Availability Zones for high availability.
- **Security Groups**: Security Groups are stateful. Only allow necessary inbound ports (e.g., 443 for HTTPS). Do not open `0.0.0.0/0` on port 22 or 3306.

## 5. Infrastructure as Code (IaC)

- **Tooling**: Prefer AWS CDK or Terraform over raw CloudFormation templates.
- **Immutability**: Never make manual changes in the AWS Console (ClickOps). All infrastructure changes must be codified, reviewed, and deployed via CI/CD.
