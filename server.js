require('dotenv').config();
const express = require('express');
const axios = require('axios');
const path = require('path');
const { randomUUID } = require('crypto');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const {
  SF_CLIENT_ID,
  SF_CLIENT_SECRET,
  SF_TOKEN_URL = 'https://login.salesforce.com/services/oauth2/token',
  SF_DATA_CLOUD_URL,
  SF_INGESTION_SOURCE = 'GlucoseMonitor',
  PORT = 3000,
  DEFAULT_PATIENT_ID = 'PATIENT-001',
} = process.env;

// Simple in-memory token cache
let cachedToken = null;
let tokenExpiresAt = 0;

async function getDataCloudToken() {
  if (cachedToken && Date.now() < tokenExpiresAt) {
    return cachedToken;
  }

  // Step 1: Get a standard Salesforce access token via Client Credentials
  const step1Params = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: SF_CLIENT_ID,
    client_secret: SF_CLIENT_SECRET,
  });

  const sfTokenResponse = await axios.post(SF_TOKEN_URL, step1Params.toString(), {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  });

  const { access_token: sfAccessToken, instance_url: sfInstanceUrl } = sfTokenResponse.data;
  console.log('Step 1 — Salesforce token obtained:', JSON.stringify({
    instance_url: sfInstanceUrl,
    scope: sfTokenResponse.data.scope,
  }));

  // Step 2: Exchange the Salesforce token for a Data Cloud-specific token
  const step2Params = new URLSearchParams({
    grant_type: 'urn:salesforce:grant-type:external:cdp',
    subject_token: sfAccessToken,
    subject_token_type: 'urn:ietf:params:oauth:token-type:access_token',
  });

  const dcTokenResponse = await axios.post(
    `${sfInstanceUrl}/services/a360/token`,
    step2Params.toString(),
    { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
  );

  if (dcTokenResponse.data.error) {
    throw new Error(`Data Cloud token exchange failed: ${dcTokenResponse.data.error} — ${dcTokenResponse.data.error_description}`);
  }

  cachedToken = dcTokenResponse.data.access_token;
  const expiresIn = dcTokenResponse.data.expires_in || 7200;
  tokenExpiresAt = Date.now() + expiresIn * 1000 * 0.9;

  console.log('Step 2 — Data Cloud token obtained:', JSON.stringify({
    instance_url: dcTokenResponse.data.instance_url,
    token_type: dcTokenResponse.data.token_type,
  }));

  return cachedToken;
}

// Return default patient ID to the frontend
app.get('/api/config', (req, res) => {
  res.json({ defaultPatientId: DEFAULT_PATIENT_ID });
});

// POST /api/glucose  — send a reading to Salesforce Data Cloud
app.post('/api/glucose', async (req, res) => {
  const { patientId, bloodSugarReading, level } = req.body;

  if (!patientId || bloodSugarReading == null || !level) {
    return res.status(400).json({ error: 'patientId, bloodSugarReading, and level are required.' });
  }

  if (!SF_CLIENT_ID || !SF_CLIENT_SECRET || !SF_DATA_CLOUD_URL) {
    return res.status(503).json({
      error: 'Salesforce credentials are not configured. Set SF_CLIENT_ID, SF_CLIENT_SECRET, and SF_DATA_CLOUD_URL environment variables.',
    });
  }

  const eventId = randomUUID();
  const dateTimeStamp = new Date().toISOString();

  const payload = {
    data: [
      {
        eventId,
        patientId,
        dateTimeStamp,
        bloodSugarReading: parseFloat(bloodSugarReading),
        level,
      },
    ],
  };

  try {
    const token = await getDataCloudToken();

    // Salesforce Data Cloud Ingestion API endpoint
    // POST {dataCloudUrl}/api/v1/ingest/sources/{sourceApiName}/GlucoseMonitorEvent
    const url = `${SF_DATA_CLOUD_URL}/api/v1/ingest/sources/${SF_INGESTION_SOURCE}/GlucoseMonitorEvent`;

    const sfResponse = await axios.post(url, payload, {
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
    });

    res.json({
      success: true,
      dateTimeStamp,
      salesforceStatus: sfResponse.status,
      payload: payload.data[0],
    });
  } catch (err) {
    // Invalidate cached token on auth errors so next request retries both steps
    if (err.response?.status === 401 || err.response?.status === 403) {
      cachedToken = null;
      tokenExpiresAt = 0;
    }

    const detail = err.response?.data ?? err.message;
    console.error('Salesforce API error:', JSON.stringify({
      status: err.response?.status,
      url: err.config?.url,
      requestBody: err.config?.data,
      responseBody: detail,
    }, null, 2));
    res.status(err.response?.status || 500).json({ error: typeof detail === 'object' ? JSON.stringify(detail) : detail });
  }
});

app.listen(PORT, () => {
  console.log(`Glucose Monitor running at http://localhost:${PORT}`);
});
