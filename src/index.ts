import express, { RequestHandler } from "express";
import cors from "cors";
import dotenv from "dotenv";
import {
  Configuration,
  PlaidApi,
  PlaidEnvironments,
  CountryCode,
  Products,
} from "plaid";
import axios from "axios";

dotenv.config();

const app = express();
const port = process.env.PORT || 3000;

// Initialize Plaid client
console.log("=== Initializing Plaid Client ===");
const plaidEnv = process.env.PLAID_ENV as keyof typeof PlaidEnvironments;
if (!PlaidEnvironments[plaidEnv]) {
  console.error(`Invalid Plaid environment: ${plaidEnv}`);
  process.exit(1);
}

console.log(`Plaid environment: ${plaidEnv}`);
const configuration = new Configuration({
  basePath: PlaidEnvironments[plaidEnv],
  baseOptions: {
    headers: {
      "PLAID-CLIENT-ID": process.env.PLAID_CLIENT_ID,
      "PLAID-SECRET": process.env.PLAID_SECRET,
    },
  },
});
const plaidClient = new PlaidApi(configuration);
console.log("Plaid client initialized successfully");

// Truelayer configuration
const TRUELAYER_BASE_URL =
  process.env.TRUELAYER_ENV === "production"
    ? "https://api.truelayer.com"
    : "https://api.truelayer-sandbox.com";

// Middleware
app.use(cors());
app.use(express.json());

// Routes
const createLinkToken: RequestHandler = async (req, res, next) => {
  try {
    console.log("=== Starting Link Token Creation ===");
    console.log("1. Checking environment variables...");
    console.log("Environment:", {
      PLAID_CLIENT_ID: process.env.PLAID_CLIENT_ID ? "Set" : "Not Set",
      PLAID_SECRET: process.env.PLAID_SECRET ? "Set" : "Not Set",
      PLAID_ENV: process.env.PLAID_ENV,
      PLAID_PRODUCTS: process.env.PLAID_PRODUCTS,
      PLAID_COUNTRY_CODES: process.env.PLAID_COUNTRY_CODES,
    });

    // Get country codes from environment variable
    const countryCodes = (process.env.PLAID_COUNTRY_CODES || "").split(
      ","
    ) as CountryCode[];
    if (!countryCodes.length) {
      throw new Error("At least one country code must be specified");
    }

    console.log("2. Preparing link token configuration...");
    const configs = {
      user: {
        client_user_id: "user-id",
      },
      client_name: "Simple Bank",
      products: (process.env.PLAID_PRODUCTS || "").split(",") as Products[],
      country_codes: countryCodes,
      language: "en",
      webhook: process.env.PLAID_WEBHOOK_URL,
    };
    console.log("Link token config:", JSON.stringify(configs, null, 2));

    console.log("3. Creating link token...");
    const response = await plaidClient.linkTokenCreate(configs);
    console.log("4. Link token created successfully");
    console.log("Response:", {
      request_id: response.data.request_id,
      expiration: response.data.expiration,
      link_token: response.data.link_token ? "Present" : "Missing",
    });

    console.log("=== Link Token Creation Complete ===");
    res.json(response.data);
  } catch (error: any) {
    console.error("=== Link Token Creation Failed ===");
    console.error("Error details:", {
      name: error.name,
      message: error.message,
      status: error.response?.status,
      statusText: error.response?.statusText,
      data: error.response?.data,
      stack: error.stack,
    });

    if (error.response?.data) {
      console.error("Plaid API Error:", error.response.data);
    }

    res.status(500).json({
      error: "Failed to create link token",
      details: error.response?.data || error.message,
      status: error.response?.status,
    });
  }
};

const exchangePublicToken: RequestHandler = async (req, res, next) => {
  try {
    const { public_token } = req.body;
    const response = await plaidClient.itemPublicTokenExchange({
      public_token,
    });
    res.json(response.data);
  } catch (error) {
    console.error("Error exchanging public token:", error);
    res.status(500).json({ error: "Failed to exchange public token" });
  }
};

const getTransactions: RequestHandler = async (req, res, next) => {
  try {
    const { access_token } = req.query;

    if (!access_token) {
      res.status(400).json({ error: "Access token is required" });
      return;
    }

    // Get the current date and date 30 days ago
    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - 30);

    const response = await plaidClient.transactionsGet({
      access_token: access_token as string,
      start_date: startDate.toISOString().split("T")[0],
      end_date: endDate.toISOString().split("T")[0],
      options: {
        count: 100,
        offset: 0,
        include_personal_finance_category: true,
      },
    });

    // Log the response for debugging
    console.log("Transactions Response:", {
      total_transactions: response.data.total_transactions,
      transactions_count: response.data.transactions?.length,
      item_id: response.data.item?.item_id,
      request_id: response.data.request_id,
    });

    // Return only the transactions array
    res.json(response.data.transactions || []);
  } catch (error: any) {
    console.error("Error fetching transactions:", error);

    // Handle specific Plaid errors
    if (error.response?.data) {
      res.status(error.response.status || 500).json(error.response.data);
      return;
    }

    res.status(500).json({
      error: "Failed to fetch transactions",
      message: error.message,
    });
  }
};

// Truelayer endpoints
const createTruelayerAuthLink: RequestHandler = async (req, res, next) => {
  try {
    const response = await axios.post(
      `${TRUELAYER_BASE_URL}/connect/token`,
      {
        client_id: process.env.TRUELAYER_CLIENT_ID,
        client_secret: process.env.TRUELAYER_CLIENT_SECRET,
        grant_type: "client_credentials",
        scope:
          "accounts balance transactions direct_debits standing_orders cards",
      },
      {
        headers: {
          "Content-Type": "application/json",
        },
      }
    );

    const accessToken = response.data.access_token;

    const authUrl =
      `${TRUELAYER_BASE_URL}/connect/auth?` +
      new URLSearchParams({
        client_id: process.env.TRUELAYER_CLIENT_ID!,
        scope:
          "accounts balance transactions direct_debits standing_orders cards",
        response_type: "code",
        redirect_uri: process.env.TRUELAYER_REDIRECT_URI!,
        providers: "uk-ob-all uk-oauth-all",
      });

    res.json({ authUrl, accessToken });
  } catch (error: any) {
    console.error(
      "Truelayer Auth Error:",
      error.response?.data || error.message
    );
    res.status(500).json({ error: "Failed to create Truelayer auth link" });
  }
};

// Exchange authorization code for access token
const exchangeTruelayerCode: RequestHandler = async (req, res, next) => {
  try {
    const { code } = req.body;

    const response = await axios.post(
      `${TRUELAYER_BASE_URL}/connect/token`,
      {
        client_id: process.env.TRUELAYER_CLIENT_ID,
        client_secret: process.env.TRUELAYER_CLIENT_SECRET,
        grant_type: "authorization_code",
        code,
        redirect_uri: process.env.TRUELAYER_REDIRECT_URI,
      },
      {
        headers: {
          "Content-Type": "application/json",
        },
      }
    );

    res.json(response.data);
  } catch (error: any) {
    console.error(
      "Truelayer Token Exchange Error:",
      error.response?.data || error.message
    );
    res.status(500).json({ error: "Failed to exchange authorization code" });
  }
};

// Get Truelayer accounts
const getTruelayerAccounts: RequestHandler = async (req, res, next) => {
  try {
    const { accessToken } = req.body;

    const response = await axios.get(`${TRUELAYER_BASE_URL}/data/v1/accounts`, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });

    res.json(response.data);
  } catch (error: any) {
    console.error(
      "Truelayer Accounts Error:",
      error.response?.data || error.message
    );
    res.status(500).json({ error: "Failed to fetch accounts" });
  }
};

// Get Truelayer transactions
const getTruelayerTransactions: RequestHandler = async (req, res, next) => {
  try {
    const { accessToken, accountId } = req.body;

    const response = await axios.get(
      `${TRUELAYER_BASE_URL}/data/v1/accounts/${accountId}/transactions`,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      }
    );

    res.json(response.data);
  } catch (error: any) {
    console.error(
      "Truelayer Transactions Error:",
      error.response?.data || error.message
    );
    res.status(500).json({ error: "Failed to fetch transactions" });
  }
};

app.post("/api/create_link_token", createLinkToken);
app.post("/api/exchange_public_token", exchangePublicToken);
app.get("/api/transactions", getTransactions);

// Add Truelayer routes
app.post("/api/truelayer/auth", createTruelayerAuthLink);
app.post("/api/truelayer/exchange", exchangeTruelayerCode);
app.post("/api/truelayer/accounts", getTruelayerAccounts);
app.post("/api/truelayer/transactions", getTruelayerTransactions);

app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
  console.log(`Plaid Environment: ${process.env.PLAID_ENV}`);
});
