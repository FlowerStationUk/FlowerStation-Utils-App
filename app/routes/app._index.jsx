import { authenticate } from "../shopify.server";

export const loader = async ({ request }) => {
  await authenticate.admin(request);
  return null;
};

export default function Index() {
  return (
    <s-page heading="FlowerStation Utils">
      <s-section heading="Welcome to FlowerStation Utils 🌸">
        <s-paragraph>
          This app helps you manage bulk discounts efficiently in your Shopify store.
          Use the navigation menu to access the Bulk Discount feature.
        </s-paragraph>
      </s-section>

      <s-section heading="Features">
        <s-unordered-list>
          <s-list-item>
            Create multiple discount codes from a master discount
          </s-list-item>
          <s-list-item>
            Upload CSV files with discount codes
          </s-list-item>
          <s-list-item>
            Organize discounts into sets for better management
          </s-list-item>
          <s-list-item>
            Bulk delete functionality for cleanup
          </s-list-item>
        </s-unordered-list>
      </s-section>
    </s-page>
  );
}
