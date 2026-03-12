import { useState, useEffect } from "react";
import { useFetcher } from "react-router";
import { authenticate } from "../shopify.server";

export const loader = async ({ request }) => {
  await authenticate.admin(request);
  return {};
};

export const action = async ({ request }) => {
  const { admin } = await authenticate.admin(request);
  const formData = await request.formData();
  const action = formData.get("action");

  try {
    if (action === "start_export") {
      const bulkOperationQuery = `
        mutation {
          bulkOperationRunQuery(
            query: """
            {
              customers {
                edges {
                  node {
                    id
                    firstName
                    lastName
                    email
                    emailMarketingConsent {
                      marketingState
                      consentUpdatedAt
                    }
                    amountSpent {
                      amount
                    }
                    numberOfOrders
                    defaultAddress {
                      company
                      address1
                      address2
                      city
                      provinceCode
                      countryCode
                      zip
                      phone
                    }
                    note
                    taxExempt
                    tags
                  }
                }
              }
            }
            """
          ) {
            bulkOperation {
              id
              status
              objectCount
            }
            userErrors {
              field
              message
            }
          }
        }
      `;

      const response = await admin.graphql(bulkOperationQuery);
      const data = await response.json();

      if (data.data?.bulkOperationRunQuery?.userErrors?.length > 0) {
        return {
          error: data.data.bulkOperationRunQuery.userErrors[0].message
        };
      }

      return {
        success: true,
        operationId: data.data.bulkOperationRunQuery.bulkOperation.id,
        status: data.data.bulkOperationRunQuery.bulkOperation.status
      };
    }

    if (action === "check_status") {
      const operationId = formData.get("operationId");

      const statusQuery = `
        query {
          node(id: "${operationId}") {
            ... on BulkOperation {
              id
              status
              objectCount
              fileSize
              url
              partialDataUrl
            }
          }
        }
      `;

      const response = await admin.graphql(statusQuery);
      const data = await response.json();

      const operation = data.data?.node;

      if (!operation) {
        return { error: "Operation not found" };
      }

      return {
        success: true,
        status: operation.status,
        objectCount: operation.objectCount,
        fileSize: operation.fileSize,
        url: operation.url,
        partialDataUrl: operation.partialDataUrl
      };
    }

    if (action === "download_and_convert") {
      const url = formData.get("url");

      const response = await fetch(url);
      const jsonlData = await response.text();

      const lines = jsonlData.trim().split('\n').filter(line => line.trim());

      const csvRows = [];
      csvRows.push([
        'ID',
        'First Name',
        'Last Name',
        'Email',
        'Email Marketing State',
        'Marketing Consent Updated At',
        'Total Spent',
        'Total Orders',
        'Company',
        'Address1',
        'Address2',
        'City',
        'Province Code',
        'Country Code',
        'Zip',
        'Phone',
        'Note',
        'Tax Exempt',
        'Tags'
      ]);

      for (const line of lines) {
        const record = JSON.parse(line);

        if (record.id && record.id.includes('Customer/')) {
          const customerId = record.id.split('Customer/')[1];
          const firstName = record.firstName || '';
          const lastName = record.lastName || '';
          const email = record.email || '';
          const marketingState = record.emailMarketingConsent?.marketingState || '';
          const consentUpdatedAt = record.emailMarketingConsent?.consentUpdatedAt || '';
          const totalSpent = record.amountSpent?.amount || '0';
          const totalOrders = record.numberOfOrders || '0';
          const company = record.defaultAddress?.company || '';
          const address1 = record.defaultAddress?.address1 || '';
          const address2 = record.defaultAddress?.address2 || '';
          const city = record.defaultAddress?.city || '';
          const provinceCode = record.defaultAddress?.provinceCode || '';
          const countryCode = record.defaultAddress?.countryCode || '';
          const zip = record.defaultAddress?.zip || '';
          const phone = record.defaultAddress?.phone || '';
          const note = record.note || '';
          const taxExempt = record.taxExempt ? 'TRUE' : 'FALSE';
          const tags = Array.isArray(record.tags) ? record.tags.join(', ') : '';

          csvRows.push([
            customerId,
            firstName,
            lastName,
            email,
            marketingState,
            consentUpdatedAt,
            totalSpent,
            totalOrders,
            company,
            address1,
            address2,
            city,
            provinceCode,
            countryCode,
            zip,
            phone,
            note,
            taxExempt,
            tags
          ]);
        }
      }

      const escapeCsvValue = (value) => {
        const stringValue = String(value);
        if (stringValue.includes(',') || stringValue.includes('"') || stringValue.includes('\n')) {
          return `"${stringValue.replace(/"/g, '""')}"`;
        }
        return stringValue;
      };

      const csvContent = csvRows.map(row => row.map(escapeCsvValue).join(',')).join('\n');

      return {
        success: true,
        csvData: csvContent,
        recordCount: csvRows.length - 1
      };
    }

    return { error: "Unknown action" };
  } catch (error) {
    console.error("Export error:", error);
    return { error: error.message };
  }
};

export default function BulkCustomerExport() {
  const fetcher = useFetcher();
  const [operationId, setOperationId] = useState(null);
  const [status, setStatus] = useState("idle");
  const [objectCount, setObjectCount] = useState(0);
  const [csvData, setCsvData] = useState(null);
  const [recordCount, setRecordCount] = useState(0);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (fetcher.data?.success && fetcher.data.operationId) {
      setOperationId(fetcher.data.operationId);
      setStatus(fetcher.data.status);
      setError(null);
    }

    if (fetcher.data?.error) {
      setError(fetcher.data.error);
      setStatus("error");
    }

    if (fetcher.data?.status) {
      setStatus(fetcher.data.status);
      setObjectCount(fetcher.data.objectCount || 0);

      if (fetcher.data.status === "COMPLETED" && fetcher.data.url) {
        fetcher.submit(
          { action: "download_and_convert", url: fetcher.data.url },
          { method: "post" }
        );
      }
    }

    if (fetcher.data?.csvData) {
      setCsvData(fetcher.data.csvData);
      setRecordCount(fetcher.data.recordCount);
      setStatus("ready");
    }
  }, [fetcher.data, fetcher]);

  useEffect(() => {
    if (operationId && status === "RUNNING") {
      const interval = setInterval(() => {
        fetcher.submit(
          { action: "check_status", operationId },
          { method: "post" }
        );
      }, 3000);

      return () => clearInterval(interval);
    }
  }, [operationId, status, fetcher]);

  const handleStartExport = () => {
    setOperationId(null);
    setStatus("starting");
    setObjectCount(0);
    setCsvData(null);
    setRecordCount(0);
    setError(null);

    fetcher.submit({ action: "start_export" }, { method: "post" });
  };

  const handleDownload = () => {
    if (!csvData) return;

    const blob = new Blob([csvData], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);

    link.setAttribute('href', url);
    link.setAttribute('download', `customers_export_${new Date().toISOString().split('T')[0]}.csv`);
    link.style.visibility = 'hidden';

    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const isProcessing = status === "RUNNING" || status === "starting";
  const isCompleted = status === "ready";
  const progressPercentage = objectCount > 0 ? Math.min(100, (objectCount / 1000) * 100) : 0;

  return (
    <s-block>
      <s-card padding="400">
        <s-block-stack gap="400">
          <s-text variant="headingLg">Bulk Customer Export</s-text>

          <s-text variant="bodyMd">
            Export all customer data using Shopify&apos;s Bulk Operations API. This includes basic info, marketing status, statistics, addresses, and metadata.
          </s-text>

          {error && (
            <s-banner status="critical">
              <s-text>{error}</s-text>
            </s-banner>
          )}

          {isProcessing && (
            <s-block-stack gap="200">
              <s-text variant="bodyMd">
                {status === "starting" ? "Starting export operation..." : "Exporting customer data..."}
              </s-text>

              {objectCount > 0 && (
                <s-block-stack gap="100">
                  <s-text variant="bodySm">
                    Processing {objectCount.toLocaleString()} customers
                  </s-text>
                  <div style={{ width: '100%', height: '8px', backgroundColor: '#e4e5e7', borderRadius: '4px', overflow: 'hidden' }}>
                    <div style={{
                      width: `${progressPercentage}%`,
                      height: '100%',
                      backgroundColor: '#008060',
                      transition: 'width 0.3s ease'
                    }} />
                  </div>
                </s-block-stack>
              )}

              <s-spinner size="small" />
            </s-block-stack>
          )}

          {isCompleted && (
            <s-banner status="success">
              <s-text>Export completed! {recordCount.toLocaleString()} customers ready to download.</s-text>
            </s-banner>
          )}

          <s-inline-stack gap="200">
            <s-button
              variant="primary"
              onClick={handleStartExport}
              disabled={isProcessing}
            >
              {isProcessing ? "Exporting..." : "Start Export"}
            </s-button>

            {isCompleted && (
              <s-button onClick={handleDownload}>
                Download CSV
              </s-button>
            )}
          </s-inline-stack>
        </s-block-stack>
      </s-card>
    </s-block>
  );
}
