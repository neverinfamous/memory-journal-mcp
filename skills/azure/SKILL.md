---
name: azure
description: |
  Microsoft Azure best practices. Use when deploying to Azure App Service, Azure Functions, AKS (Azure Kubernetes Service), Cosmos DB, configuring Azure Entra ID (Active Directory), or managing Azure Resource Manager (ARM/Bicep) templates. Do NOT trigger for generic "deploy my app" requests without clarifying the target platform.
---

# Microsoft Azure Best Practices

**STOP.** Your knowledge of Azure may be outdated. Prefer retrieval over pre-training for any version-sensitive Azure configuration. Fetch current documentation when in doubt.

Standards for deploying and managing workloads securely on Microsoft Azure.

## 1. Identity & Access (Azure Entra ID / Active Directory)

- **Managed Identities**: Use System-Assigned or User-Assigned Managed Identities for Azure resources (VMs, App Services, Functions) to authenticate to other Azure services (Key Vault, SQL, Storage) without managing credentials.
- **RBAC**: Use Azure Role-Based Access Control. Assign roles to Entra ID Groups rather than individual users to simplify lifecycle management.
- **Key Vault**: Never store secrets in application configuration files. Store them in Azure Key Vault and reference them using Key Vault References in App Services/Functions.

## 2. Compute (App Service, Functions, AKS)

- **Azure Functions**: For production serverless, use the Premium plan to avoid cold starts and gain VNet integration capabilities, unless strict cost minimization on the Consumption plan is required.
- **AKS (Azure Kubernetes Service)**: Use Azure CNI for advanced networking. Enable Microsoft Entra ID integration for Kubernetes RBAC. Use Azure Policy to enforce pod security standards.
- **App Service**: Enable VNet Integration to access private resources. Turn on "Always On" (Basic tier and above) to prevent the worker process from idling out.

## 3. Data (Cosmos DB, Azure SQL, Storage)

- **Cosmos DB**: Carefully choose the Partition Key, as it determines scalability and performance. Changes to the partition key require data migration.
- **Azure SQL Database**: Enable Transparent Data Encryption (TDE). Use Private Endpoints (Azure Private Link) to ensure database traffic never traverses the public internet.
- **Storage Accounts**: Disable public network access on Storage Accounts. Use Shared Access Signatures (SAS) with short expiration times for temporary client access to blobs.

## 4. Networking & Security

- **Virtual Networks (VNet)**: Implement a Hub-and-Spoke topology for enterprise deployments. Use Azure Firewall in the hub and Network Security Groups (NSGs) on the spokes.
- **Front Door / App Gateway**: Use Azure Front Door for global load balancing and WAF. Use Application Gateway for regional layer-7 load balancing.

## 5. Infrastructure as Code (IaC)

- **Bicep & Terraform**: Prefer Bicep (Azure's native declarative DSL) or Terraform over verbose JSON ARM templates.
