import { useState } from "react";
import {
  Avatar,
  CardHeader,
  Link,
  Grid,
  TextField,
  Typography,
  Button,
} from "@mui/material";
import { useNavigate } from "react-router-dom";

import logo from "./logo.png";

function App() {
  const [invalidHash, setInvalidHash] = useState(false);
  const [txHash, setTxHash] = useState("");

  const navigate = useNavigate();

  return (
    <>
      <div style={{ paddingTop: "25px" }} />
      <Grid container spacing={1}>
        <Grid item xs={1}></Grid>
        <Grid item xs={10}>
          <CardHeader
            avatar={
              <Link href="/">
                <Avatar alt="logo" src={logo} />
              </Link>
            }
            title={
              <Typography variant="h4" component="h4">
                ArbiTx - Arbitrium Transaction Tracer
              </Typography>
            }
          />
          <br />
          <Typography variant="h5" component="h5">
            Transaction Tracer
          </Typography>
          <br />
          <TextField
            error={invalidHash}
            helperText={invalidHash && "Invalid tx hash"}
            onChange={(e) => setTxHash(e.target.value)}
            value={txHash}
            fullWidth
            label="Arbitrum tx hash"
            id="fullWidth"
          />
          <br />
          <br />
          <Button
            style={{ width: "100%" }}
            variant="outlined"
            onClick={() => {
              if (txHash.length !== 66 && txHash.slice(0, 2) !== "0x") {
                setInvalidHash(true);
                return;
              }
              navigate(`/tx/${txHash}`);
            }}
          >
            Trace Tx
          </Button>
        </Grid>
        <Grid item xs={1}></Grid>
      </Grid>

      <div style={{ paddingTop: "50px" }} />
      <div style={{ paddingBottom: "30px" }} />
    </>
  );
}

export default App;
