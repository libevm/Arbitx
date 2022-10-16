import React from "react";
import ReactDOM from "react-dom/client";
import "./index.css";
import App from "./App";
import Trace from "./Trace";
import reportWebVitals from "./reportWebVitals";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { ThemeProvider, createTheme } from "@mui/material/styles";
import CssBaseline from "@mui/material/CssBaseline";

import "@fontsource/roboto/300.css";
import "@fontsource/roboto/400.css";
import "@fontsource/roboto/500.css";
import "@fontsource/roboto/700.css";

const darkTheme = createTheme({
  palette: {
    mode: "dark",
  },
});

const root = ReactDOM.createRoot(document.getElementById("root"));
root.render(
  <React.StrictMode>
    <ThemeProvider theme={darkTheme}>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<App />} />
          <Route path="tx/:txhash" element={<Trace />} />
        </Routes>
      </BrowserRouter>
      <CssBaseline />
    </ThemeProvider>
  </React.StrictMode>
);
// If you want to start measuring performance in your app, pass a function
// to log results (for example: reportWebVitals(console.log))
// or send to an analytics endpoint. Learn more: https://bit.ly/CRA-vitals
reportWebVitals();
