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

// Truelayer configuration
const TRUELAYER_AUTH_URL =
  process.env.TRUELAYER_ENV === "production"
    ? "https://auth.truelayer.com"
    : "https://auth.truelayer-sandbox.com";

const TRUELAYER_API_URL =
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
    console.log("=== Starting Truelayer Auth Link Creation ===");
    console.log("1. Checking environment variables...");

    // Validate required environment variables
    const requiredEnvVars = [
      "TRUELAYER_CLIENT_ID",
      "TRUELAYER_CLIENT_SECRET",
      "TRUELAYER_REDIRECT_URI",
      "TRUELAYER_ENV",
    ];

    const missingVars = requiredEnvVars.filter(
      (varName) => !process.env[varName]
    );
    if (missingVars.length > 0) {
      throw new Error(
        `Missing required environment variables: ${missingVars.join(", ")}`
      );
    }

    console.log("Environment variables check passed");
    console.log("TRUELAYER_ENV:", process.env.TRUELAYER_ENV);
    console.log("TRUELAYER_AUTH_URL:", TRUELAYER_AUTH_URL);
    console.log("TRUELAYER_CLIENT_ID:", process.env.TRUELAYER_CLIENT_ID);
    console.log("TRUELAYER_REDIRECT_URI:", process.env.TRUELAYER_REDIRECT_URI);

    // Generate the auth URL directly - no token needed for initial auth
    console.log("2. Generating auth URL...");
    const nonce = Math.random().toString(36).substring(2, 15);
    const state = Math.random().toString(36).substring(2, 15);

    const authParams = {
      response_type: "code",
      client_id: process.env.TRUELAYER_CLIENT_ID!,
      scope: "info accounts balance cards transactions",
      redirect_uri: process.env.TRUELAYER_REDIRECT_URI!,
      providers: "uk-ob-all uk-oauth-all",
      state,
      nonce,
    };

    console.log("Auth parameters:", authParams);

    const authUrl =
      `${TRUELAYER_AUTH_URL}/?` + new URLSearchParams(authParams).toString();

    console.log("3. Auth URL generated successfully:", authUrl);
    console.log("=== Truelayer Auth Link Creation Complete ===");

    res.json({ authUrl, state, nonce });
  } catch (error: any) {
    console.error("=== Truelayer Auth Link Creation Failed ===");
    console.error("Error details:", {
      name: error.name,
      message: error.message,
      status: error.response?.status,
      statusText: error.response?.statusText,
      data: error.response?.data,
      stack: error.stack,
    });

    if (error.response?.data) {
      console.error("Truelayer API Error:", error.response.data);
    }

    res.status(500).json({
      error: "Failed to create Truelayer auth link",
      details: error.response?.data || error.message,
      status: error.response?.status,
    });
  }
};

// Update the exchangeTruelayerCode function to use the correct API URL
const exchangeTruelayerCode: RequestHandler = async (req, res, next) => {
  try {
    const { code } = req.body;

    // Create Basic Auth header
    const credentials = Buffer.from(
      `${process.env.TRUELAYER_CLIENT_ID}:${process.env.TRUELAYER_CLIENT_SECRET}`
    ).toString("base64");

    console.log("Exchanging code for token...");
    console.log("Using URL:", `${TRUELAYER_AUTH_URL}/connect/token`);
    console.log("With credentials:", credentials);

    const response = await axios.post(
      `${TRUELAYER_AUTH_URL}/connect/token`,
      new URLSearchParams({
        grant_type: "authorization_code",
        redirect_uri: process.env.TRUELAYER_REDIRECT_URI!,
        code,
      }).toString(),
      {
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Authorization: `Basic ${credentials}`,
        },
      }
    );

    console.log("Token exchange successful:", response.data);
    res.json(response.data);
  } catch (error: any) {
    console.error(
      "Truelayer Token Exchange Error:",
      error.response?.data || error.message
    );
    console.error("Error details:", {
      status: error.response?.status,
      statusText: error.response?.statusText,
      data: error.response?.data,
    });
    res.status(500).json({
      error: "Failed to exchange authorization code",
      details: error.response?.data || error.message,
    });
  }
};

// Get Truelayer accounts
const getTruelayerAccounts: RequestHandler = async (req, res, next) => {
  try {
    const { accessToken } = req.body;

    const response = await axios.get(`${TRUELAYER_API_URL}/data/v1/accounts`, {
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

    // Calculate current month's date range
    const now = new Date();
    const currentMonth = now.getMonth();
    const currentYear = now.getFullYear();

    // Calculate start of current month
    const startOfCurrentMonth = new Date(currentYear, currentMonth, 1);
    startOfCurrentMonth.setHours(0, 0, 0, 0);

    // Use current date instead of end of month
    const endDate = new Date(now);
    endDate.setHours(23, 59, 59, 999);

    const response = await axios.get(
      `${TRUELAYER_API_URL}/data/v1/accounts/${accountId}/transactions`,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
        params: {
          from: startOfCurrentMonth.toISOString(),
          to: endDate.toISOString(),
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
