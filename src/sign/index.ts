"use strict";

import {
  encodeForSigningClaim,
  type XrplDefinitions,
} from "ripple-binary-codec";
import { sign as rk_sign } from "ripple-keypairs";
import Sign from "xrpl-sign-keypairs";
import Account from "../schema/Account";
import { combine } from "../utils";

type SignOptions = {
  [key: string]: any;
};

type SignedObject = {
  type: "SignedTx" | "MultiSignedTx" | "SignedPayChanAuth";
  id: string;
  signedTransaction: string;
  txJson: Record<string, unknown>;
  signers: string[];
};

const sign = (
  transaction: Object,
  account?: Account | Account[],
  definitions?: XrplDefinitions
): SignedObject => {
  let accounts = [];
  const Tx: any = Object.assign({}, transaction);

  if (Object.keys(Tx).indexOf("TransactionType") > -1) {
    if (Tx?.TransactionType?.toLowerCase() === "signin") {
      Object.assign(Tx, {
        TransactionType: undefined,
        SignIn: true,
      });
    }
  }

  if (account instanceof Object && !Array.isArray(account)) {
    if (account instanceof Account) {
      accounts.push(account);
    } else {
      throw new Error("Account not instanceof XRPL Account");
    }
  } else if (Array.isArray(account)) {
    account.forEach((account) => {
      if (account instanceof Account) {
        accounts.push(account);
      } else {
        throw new Error("Account not instanceof XRPL Account");
      }
    });
  }

  if (
    Tx?.TransactionType?.toLowerCase() === "paymentchannelauthorize" ||
    Tx?.command?.toLowerCase() === "channel_authorize" ||
    (!Tx?.TransactionType && !Tx?.command && Tx?.channel && Tx?.amount)
  ) {
    if (accounts.length === 1) {
      if (
        typeof accounts[0]._signAs === "string" &&
        accounts[0]._signAs !== ""
      ) {
        throw new Error("Payment channel authorization: cannot Sign As");
      }
      const claimInput = { channel: Tx.channel, amount: Tx.amount };
      const claim = encodeForSigningClaim(claimInput);
      const signed = rk_sign(claim, accounts[0].keypair.privateKey);
      return {
        type: "SignedPayChanAuth",
        id: "",
        signedTransaction: signed,
        txJson: claimInput,
        signers: [accounts[0].address || ""],
      };
    } else {
      throw new Error(
        "Payment channel authorization: multi-signing not supported"
      );
    }
  }

  if (accounts.length === 1) {
    const txJSON = JSON.stringify(Tx);
    let options: SignOptions = { signAs: undefined, definitions };
    if (typeof accounts[0]._signAs === "string" && accounts[0]._signAs !== "") {
      // signAs explicitly set
      options.signAs = accounts[0]._signAs;
    }
    const tx = Sign(txJSON, accounts[0].keypair, options);
    return {
      type: "SignedTx",
      id: tx.id,
      signedTransaction: tx.signedTransaction,
      txJson: tx.txJson,
      signers: [
        typeof accounts[0]._signAs === "string"
          ? accounts[0]._signAs
          : accounts[0].address || "",
      ],
    };
  } else {
    const Codec = require("ripple-binary-codec");

    const MultiSignedTransactionBinary = (() => {
      if (
        transaction instanceof Object &&
        Array.isArray(transaction) &&
        accounts.length === 0 &&
        transaction.length > 0
      ) {
        if (
          transaction.length ===
          transaction.filter((t) => {
            return (
              t instanceof Object &&
              t !== null &&
              typeof t.signedTransaction === "string"
            );
          }).length
        ) {
          // MultiSign [ { signedTransaction: ... } , ... ]
          return combine(
            transaction.map((t) => {
              return t.signedTransaction.toUpperCase();
            }),
            definitions
          );
        } else if (
          transaction.length ===
          transaction.filter((t) => {
            return (
              typeof t === "string" && t.toUpperCase().match(/^[A-F0-9]+$/)
            );
          }).length
        ) {
          // MultiSign [ 'AEF9...', 'C6DA...' ]
          return combine(
            transaction.map((t) => {
              return t.toUpperCase();
            }),
            definitions
          );
        } else {
          throw new Error(
            "TX Blob for multiSign not an array of { signedTransaction: ... } objects or blob strings"
          );
        }
      } else {
        // MultiSign [ lib.sign(...), lib.sign(...) ]
        return combine(
          accounts.map((account) => {
            return Sign(JSON.stringify(Tx), account.keypair, {
              signAs:
                typeof account._signAs === "string"
                  ? account._signAs
                  : account.address,
              definitions,
            }).signedTransaction;
          }),
          definitions
        );
      }
    })();

    const txJson = Codec.decode(
      MultiSignedTransactionBinary.signedTransaction,
      definitions
    );
    return {
      type: "MultiSignedTx",
      id: MultiSignedTransactionBinary.id,
      signedTransaction: MultiSignedTransactionBinary.signedTransaction,
      txJson: txJson,
      signers: txJson.Signers,
    };
  }
};

export { sign };

export type { SignedObject };

export default sign;
