import { useState, useEffect } from "react";
import { useFetcher } from "react-router";
import { authenticate } from "../shopify.server";

export const loader = async ({ request }) => {
  const { admin } = await authenticate.admin(request);

  try {
    const currentOperationQuery = `
      query {
        currentBulkOperation {
          id
          status
          objectCount
          fileSize
          url
          partialDataUrl
        }
      }
    `;

    const response = await admin.graphql(currentOperationQuery);
    const data = await response.json();

    const currentOperation = data.data?.currentBulkOperation;

    if (currentOperation && (currentOperation.status === "RUNNING" || currentOperation.status === "CREATED")) {
      return {
        existingOperation: {
          id: currentOperation.id,
          status: currentOperation.status,
          objectCount: currentOperation.objectCount || 0
        }
      };
    }

    return { existingOperation: null };
  } catch (error) {
    console.error("Loader error:", error);
    return { existingOperation: null };
  }
};

export const action = async ({ request }) => {
  const { admin } = await authenticate.admin(request);
  const formData = await request.formData();
  const action = formData.get("action");

  try {
    if (action === "check_current") {
      const currentOperationQuery = `
        query {
          currentBulkOperation {
            id
            status
            objectCount
            fileSize
            url
            partialDataUrl
          }
        }
      `;

      const response = await admin.graphql(currentOperationQuery);
      const data = await response.json();

      const currentOperation = data.data?.currentBulkOperation;

      if (!currentOperation) {
        return { success: true, hasOperation: false };
      }

      return {
        success: true,
        hasOperation: true,
        operationId: currentOperation.id,
        status: currentOperation.status,
        objectCount: currentOperation.objectCount || 0,
        url: currentOperation.url,
        partialDataUrl: currentOperation.partialDataUrl
      };
    }

    if (action === "start_export") {
      const currentOperationQuery = `
        query {
          currentBulkOperation {
            id
            status
          }
        }
      `;

      const currentOpResponse = await admin.graphql(currentOperationQuery);
      const currentOpData = await currentOpResponse.json();

      const currentOp = currentOpData.data?.currentBulkOperation;

      if (currentOp && (currentOp.status === "RUNNING" || currentOp.status === "CREATED")) {
        return {
          error: "A bulk operation is already running. Please wait for it to complete or cancel it from the Shopify admin.",
          existingOperationId: currentOp.id
        };
      }

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
        const errorMsg = data.data.bulkOperationRunQuery.userErrors[0].message;
        return {
          error: errorMsg
        };
      }

      return {
        success: true,
        operationId: data.data.bulkOperationRunQuery.bulkOperation.id,
        status: data.data.bulkOperationRunQuery.bulkOperation.status,
        message: "Export started successfully"
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
  const [isPolling, setIsPolling] = useState(false);

  useEffect(() => {
    if (fetcher.data) {
      if (fetcher.data.existingOperation) {
        const existing = fetcher.data.existingOperation;
        setOperationId(existing.id);
        setStatus(existing.status);
        setObjectCount(existing.objectCount || 0);
        setIsPolling(true);
      }

      if (fetcher.data.success && fetcher.data.operationId) {
        setOperationId(fetcher.data.operationId);
        setStatus(fetcher.data.status);
        setError(null);
        setIsPolling(true);
      }

      if (fetcher.data.error) {
        setError(fetcher.data.error);
        setStatus("error");
        setIsPolling(false);
      }

      if (fetcher.data.hasOperation !== undefined) {
        if (fetcher.data.hasOperation) {
          setOperationId(fetcher.data.operationId);
          setStatus(fetcher.data.status);
          setObjectCount(fetcher.data.objectCount || 0);

          if (fetcher.data.status === "COMPLETED" && fetcher.data.url) {
            setIsPolling(false);
            fetcher.submit(
              { action: "download_and_convert", url: fetcher.data.url },
              { method: "post" }
            );
          } else if (fetcher.data.status === "RUNNING" || fetcher.data.status === "CREATED") {
            setIsPolling(true);
          } else {
            setIsPolling(false);
          }
        } else {
          setIsPolling(false);
        }
      }

      if (fetcher.data.csvData) {
        setCsvData(fetcher.data.csvData);
        setRecordCount(fetcher.data.recordCount);
        setStatus("ready");
        setIsPolling(false);
      }
    }
  }, [fetcher.data, fetcher]);

  useEffect(() => {
    if (isPolling && operationId && (status === "RUNNING" || status === "CREATED")) {
      const interval = setInterval(() => {
        fetcher.submit(
          { action: "check_current" },
          { method: "post" }
        );
      }, 2000);

      return () => clearInterval(interval);
    }
  }, [isPolling, operationId, status, fetcher]);

  const handleStartExport = () => {
    setOperationId(null);
    setStatus("starting");
    setObjectCount(0);
    setCsvData(null);
    setRecordCount(0);
    setError(null);
    setIsPolling(false);

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

  const isProcessing = status === "RUNNING" || status === "CREATED" || status === "starting";
  const isCompleted = status === "ready";
  const canStartExport = status === "idle" || status === "ready" || status === "error";

  return (
    <s-page heading="Bulk Customer Export">
      {error && (
        <s-banner status="critical">
          <s-stack direction="block" gap="tight">
            <s-text size="bold">Error</s-text>
            <s-text>{error}</s-text>
          </s-stack>
        </s-banner>
      )}

      {isProcessing && (
        <s-banner status="info">
          <s-stack direction="block" gap="tight">
            <s-text>
              {status === "starting" || status === "CREATED"
                ? "Initializing export operation..."
                : "Exporting customer data..."}
            </s-text>
            {objectCount > 0 && (
              <>
                <s-text size="small" color="subdued">
                  Progress: {objectCount.toLocaleString()} customers
                </s-text>
                <s-progress-bar progress={50} />
              </>
            )}
          </s-stack>
        </s-banner>
      )}

      {isCompleted && (
        <s-banner status="success">
          <s-stack direction="block" gap="tight">
            <s-text size="bold">Export Complete</s-text>
            <s-text>
              Successfully exported {recordCount.toLocaleString()} customers. Click the download button below to save your CSV file.
            </s-text>
          </s-stack>
        </s-banner>
      )}

      <s-section heading="Export Customer Data">
        <s-paragraph>
          Export all customer data using Shopify&apos;s Bulk Operations API. This includes basic information, marketing consent, order statistics, addresses, tags, and notes.
        </s-paragraph>

        <s-paragraph color="subdued" size="small">
          <strong>Included fields:</strong> First Name, Last Name, Email, Email Marketing Status, Total Spent, Total Orders, Company, Address, City, Province, Country, Zip, Phone, Note, Tax Exempt, Tags
        </s-paragraph>

        <s-stack direction="inline" gap="base" style={{ marginTop: "16px" }}>
          <s-button
            variant="primary"
            onClick={handleStartExport}
            disabled={!canStartExport || fetcher.state === "submitting"}
          >
            {isProcessing ? "Exporting..." : "Start Export"}
          </s-button>

          {isCompleted && (
            <s-button onClick={handleDownload}>
              Download CSV
            </s-button>
          )}
        </s-stack>

        {isProcessing && (
          <s-text size="small" color="subdued" style={{ display: "block", marginTop: "12px" }}>
            Please keep this page open until the export completes. This may take several minutes for large stores.
          </s-text>
        )}
      </s-section>
    </s-page>
  );
}

