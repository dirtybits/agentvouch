// Committed copy of the Anchor-generated program type (`anchor build` writes
// it to the gitignored target/types/agentvouch.ts). Vendored here so the CLI
// typechecks without the Anchor build artifact. In sync with web/agentvouch.json
// (program AGNtBjLEHFnssPzQjZJnnqiaUgtkaxj4fFaWoKD6yVdg). To regenerate after an
// IDL change: run `anchor build` at the repo root, then copy target/types/agentvouch.ts here.

/**
 * Program IDL in camelCase format in order to be used in JS/TS.
 *
 * Note that this is only a type helper and is not the actual IDL. The original
 * IDL can be found at `target/idl/agentvouch.json`.
 */
export type Agentvouch = {
  "address": "AGNtBjLEHFnssPzQjZJnnqiaUgtkaxj4fFaWoKD6yVdg",
  "metadata": {
    "name": "agentvouch",
    "version": "0.1.0",
    "spec": "0.1.0",
    "description": "AgentVouch Solana trust protocol"
  },
  "instructions": [
    {
      "name": "claimPurchaseRefund",
      "discriminator": [
        123,
        72,
        208,
        183,
        74,
        125,
        80,
        113
      ],
      "accounts": [
        {
          "name": "refundPool",
          "writable": true
        },
        {
          "name": "purchase",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  117,
                  114,
                  99,
                  104,
                  97,
                  115,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "buyer"
              },
              {
                "kind": "account",
                "path": "purchase.skill_listing",
                "account": "purchase"
              },
              {
                "kind": "account",
                "path": "purchase.listing_revision",
                "account": "purchase"
              }
            ]
          }
        },
        {
          "name": "refundClaim",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  114,
                  101,
                  102,
                  117,
                  110,
                  100,
                  95,
                  99,
                  108,
                  97,
                  105,
                  109
                ]
              },
              {
                "kind": "account",
                "path": "refundPool"
              },
              {
                "kind": "account",
                "path": "purchase"
              }
            ]
          }
        },
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "usdcMint"
        },
        {
          "name": "refundVaultAuthority",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  114,
                  101,
                  102,
                  117,
                  110,
                  100,
                  95,
                  118,
                  97,
                  117,
                  108,
                  116,
                  95,
                  97,
                  117,
                  116,
                  104,
                  111,
                  114,
                  105,
                  116,
                  121
                ]
              },
              {
                "kind": "account",
                "path": "refundPool"
              }
            ]
          }
        },
        {
          "name": "refundVault",
          "writable": true
        },
        {
          "name": "buyerUsdcAccount",
          "writable": true
        },
        {
          "name": "buyer",
          "writable": true,
          "signer": true
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": []
    },
    {
      "name": "claimVoucherRevenue",
      "discriminator": [
        197,
        41,
        210,
        196,
        139,
        237,
        188,
        183
      ],
      "accounts": [
        {
          "name": "authorProfile",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  97,
                  103,
                  101,
                  110,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "author_profile.authority",
                "account": "agentProfile"
              }
            ]
          }
        },
        {
          "name": "vouch",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  111,
                  117,
                  99,
                  104
                ]
              },
              {
                "kind": "account",
                "path": "voucherProfile"
              },
              {
                "kind": "account",
                "path": "authorProfile"
              }
            ]
          }
        },
        {
          "name": "voucherProfile",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  97,
                  103,
                  101,
                  110,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "voucher"
              }
            ]
          }
        },
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "usdcMint"
        },
        {
          "name": "authorRewardVaultAuthority",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  97,
                  117,
                  116,
                  104,
                  111,
                  114,
                  95,
                  114,
                  101,
                  119,
                  97,
                  114,
                  100,
                  95,
                  118,
                  97,
                  117,
                  108,
                  116,
                  95,
                  97,
                  117,
                  116,
                  104,
                  111,
                  114,
                  105,
                  116,
                  121
                ]
              },
              {
                "kind": "account",
                "path": "authorProfile"
              }
            ]
          }
        },
        {
          "name": "authorRewardVault",
          "writable": true
        },
        {
          "name": "voucherUsdcAccount",
          "writable": true
        },
        {
          "name": "voucher",
          "writable": true,
          "signer": true
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        }
      ],
      "args": []
    },
    {
      "name": "closeSkillListing",
      "discriminator": [
        81,
        95,
        50,
        47,
        45,
        66,
        132,
        124
      ],
      "accounts": [
        {
          "name": "skillListing",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  115,
                  107,
                  105,
                  108,
                  108
                ]
              },
              {
                "kind": "account",
                "path": "author"
              },
              {
                "kind": "arg",
                "path": "skillId"
              }
            ]
          }
        },
        {
          "name": "authorProfile",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  97,
                  103,
                  101,
                  110,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "author"
              }
            ]
          }
        },
        {
          "name": "author",
          "writable": true,
          "signer": true
        }
      ],
      "args": [
        {
          "name": "skillId",
          "type": "string"
        }
      ]
    },
    {
      "name": "createRefundPool",
      "discriminator": [
        135,
        46,
        198,
        133,
        221,
        230,
        60,
        194
      ],
      "accounts": [
        {
          "name": "authorDispute"
        },
        {
          "name": "skillListing",
          "writable": true
        },
        {
          "name": "listingSettlement",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  108,
                  105,
                  115,
                  116,
                  105,
                  110,
                  103,
                  95,
                  115,
                  101,
                  116,
                  116,
                  108,
                  101,
                  109,
                  101,
                  110,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "skillListing"
              },
              {
                "kind": "account",
                "path": "listing_settlement.revision",
                "account": "listingSettlement"
              }
            ]
          }
        },
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "authority",
          "signer": true
        },
        {
          "name": "usdcMint"
        },
        {
          "name": "authorProceedsVaultAuthority",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  97,
                  117,
                  116,
                  104,
                  111,
                  114,
                  95,
                  112,
                  114,
                  111,
                  99,
                  101,
                  101,
                  100,
                  115,
                  95,
                  118,
                  97,
                  117,
                  108,
                  116,
                  95,
                  97,
                  117,
                  116,
                  104,
                  111,
                  114,
                  105,
                  116,
                  121
                ]
              },
              {
                "kind": "account",
                "path": "listingSettlement"
              }
            ]
          }
        },
        {
          "name": "authorProceedsVault",
          "writable": true
        },
        {
          "name": "refundPool",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  114,
                  101,
                  102,
                  117,
                  110,
                  100,
                  95,
                  112,
                  111,
                  111,
                  108
                ]
              },
              {
                "kind": "account",
                "path": "authorDispute"
              }
            ]
          }
        },
        {
          "name": "refundVaultAuthority",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  114,
                  101,
                  102,
                  117,
                  110,
                  100,
                  95,
                  118,
                  97,
                  117,
                  108,
                  116,
                  95,
                  97,
                  117,
                  116,
                  104,
                  111,
                  114,
                  105,
                  116,
                  121
                ]
              },
              {
                "kind": "account",
                "path": "refundPool"
              }
            ]
          }
        },
        {
          "name": "refundVault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  114,
                  101,
                  102,
                  117,
                  110,
                  100,
                  95,
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "refundPool"
              }
            ]
          }
        },
        {
          "name": "challengerUsdcAccount",
          "writable": true
        },
        {
          "name": "payer",
          "writable": true,
          "signer": true
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "requestedRefundPoolUsdcMicros",
          "type": "u64"
        }
      ]
    },
    {
      "name": "createSkillListing",
      "discriminator": [
        101,
        61,
        26,
        213,
        47,
        75,
        13,
        122
      ],
      "accounts": [
        {
          "name": "skillListing",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  115,
                  107,
                  105,
                  108,
                  108
                ]
              },
              {
                "kind": "account",
                "path": "author"
              },
              {
                "kind": "arg",
                "path": "skillId"
              }
            ]
          }
        },
        {
          "name": "authorProfile",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  97,
                  103,
                  101,
                  110,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "author"
              }
            ]
          }
        },
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "authorBond",
          "optional": true
        },
        {
          "name": "usdcMint"
        },
        {
          "name": "listingSettlement",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  108,
                  105,
                  115,
                  116,
                  105,
                  110,
                  103,
                  95,
                  115,
                  101,
                  116,
                  116,
                  108,
                  101,
                  109,
                  101,
                  110,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "skillListing"
              },
              {
                "kind": "const",
                "value": [
                  0,
                  0,
                  0,
                  0,
                  0,
                  0,
                  0,
                  0
                ]
              }
            ]
          }
        },
        {
          "name": "authorProceedsVaultAuthority",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  97,
                  117,
                  116,
                  104,
                  111,
                  114,
                  95,
                  112,
                  114,
                  111,
                  99,
                  101,
                  101,
                  100,
                  115,
                  95,
                  118,
                  97,
                  117,
                  108,
                  116,
                  95,
                  97,
                  117,
                  116,
                  104,
                  111,
                  114,
                  105,
                  116,
                  121
                ]
              },
              {
                "kind": "account",
                "path": "listingSettlement"
              }
            ]
          }
        },
        {
          "name": "authorProceedsVault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  97,
                  117,
                  116,
                  104,
                  111,
                  114,
                  95,
                  112,
                  114,
                  111,
                  99,
                  101,
                  101,
                  100,
                  115,
                  95,
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "listingSettlement"
              }
            ]
          }
        },
        {
          "name": "author",
          "writable": true,
          "signer": true
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "skillId",
          "type": "string"
        },
        {
          "name": "skillUri",
          "type": "string"
        },
        {
          "name": "name",
          "type": "string"
        },
        {
          "name": "description",
          "type": "string"
        },
        {
          "name": "priceUsdcMicros",
          "type": "u64"
        }
      ]
    },
    {
      "name": "depositAuthorBond",
      "discriminator": [
        20,
        24,
        47,
        9,
        171,
        195,
        73,
        223
      ],
      "accounts": [
        {
          "name": "authorBond",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  97,
                  117,
                  116,
                  104,
                  111,
                  114,
                  95,
                  98,
                  111,
                  110,
                  100
                ]
              },
              {
                "kind": "account",
                "path": "author"
              }
            ]
          }
        },
        {
          "name": "authorProfile",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  97,
                  103,
                  101,
                  110,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "author"
              }
            ]
          }
        },
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "usdcMint"
        },
        {
          "name": "authorUsdcAccount",
          "writable": true
        },
        {
          "name": "authorBondVaultAuthority",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  97,
                  117,
                  116,
                  104,
                  111,
                  114,
                  95,
                  98,
                  111,
                  110,
                  100,
                  95,
                  118,
                  97,
                  117,
                  108,
                  116,
                  95,
                  97,
                  117,
                  116,
                  104,
                  111,
                  114,
                  105,
                  116,
                  121
                ]
              },
              {
                "kind": "account",
                "path": "author"
              }
            ]
          }
        },
        {
          "name": "authorBondVault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  97,
                  117,
                  116,
                  104,
                  111,
                  114,
                  95,
                  98,
                  111,
                  110,
                  100,
                  95,
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "author"
              }
            ]
          }
        },
        {
          "name": "author",
          "writable": true,
          "signer": true
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "amountUsdcMicros",
          "type": "u64"
        }
      ]
    },
    {
      "name": "initializeConfig",
      "discriminator": [
        208,
        127,
        21,
        1,
        194,
        190,
        196,
        70
      ],
      "accounts": [
        {
          "name": "config",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "usdcMint"
        },
        {
          "name": "protocolTreasuryVaultAuthority",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  116,
                  114,
                  101,
                  97,
                  115,
                  117,
                  114,
                  121,
                  95,
                  118,
                  97,
                  117,
                  108,
                  116,
                  95,
                  97,
                  117,
                  116,
                  104,
                  111,
                  114,
                  105,
                  116,
                  121
                ]
              }
            ]
          }
        },
        {
          "name": "protocolTreasuryVault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  116,
                  114,
                  101,
                  97,
                  115,
                  117,
                  114,
                  121,
                  95,
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              }
            ]
          }
        },
        {
          "name": "x402SettlementVaultAuthority",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  120,
                  52,
                  48,
                  50,
                  95,
                  115,
                  101,
                  116,
                  116,
                  108,
                  101,
                  109,
                  101,
                  110,
                  116,
                  95,
                  118,
                  97,
                  117,
                  108,
                  116,
                  95,
                  97,
                  117,
                  116,
                  104,
                  111,
                  114,
                  105,
                  116,
                  121
                ]
              }
            ]
          }
        },
        {
          "name": "x402SettlementVault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "account",
                "path": "x402SettlementVaultAuthority"
              },
              {
                "kind": "account",
                "path": "tokenProgram"
              },
              {
                "kind": "account",
                "path": "usdcMint"
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                140,
                151,
                37,
                143,
                78,
                36,
                137,
                241,
                187,
                61,
                16,
                41,
                20,
                142,
                13,
                131,
                11,
                90,
                19,
                153,
                218,
                255,
                16,
                132,
                4,
                142,
                123,
                216,
                219,
                233,
                248,
                89
              ]
            }
          }
        },
        {
          "name": "authority"
        },
        {
          "name": "payer",
          "writable": true,
          "signer": true
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        },
        {
          "name": "associatedTokenProgram",
          "address": "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "chainContext",
          "type": "string"
        },
        {
          "name": "configAuthority",
          "type": "pubkey"
        },
        {
          "name": "treasuryAuthority",
          "type": "pubkey"
        },
        {
          "name": "settlementAuthority",
          "type": "pubkey"
        },
        {
          "name": "pauseAuthority",
          "type": "pubkey"
        },
        {
          "name": "slashPercentage",
          "type": "u8"
        },
        {
          "name": "cooldownPeriod",
          "type": "i64"
        }
      ]
    },
    {
      "name": "initializeListingSettlement",
      "discriminator": [
        161,
        155,
        208,
        205,
        43,
        43,
        23,
        110
      ],
      "accounts": [
        {
          "name": "skillListing",
          "writable": true
        },
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "usdcMint"
        },
        {
          "name": "listingSettlement",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  108,
                  105,
                  115,
                  116,
                  105,
                  110,
                  103,
                  95,
                  115,
                  101,
                  116,
                  116,
                  108,
                  101,
                  109,
                  101,
                  110,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "skillListing"
              },
              {
                "kind": "account",
                "path": "skill_listing.current_revision",
                "account": "skillListing"
              }
            ]
          }
        },
        {
          "name": "authorProceedsVaultAuthority",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  97,
                  117,
                  116,
                  104,
                  111,
                  114,
                  95,
                  112,
                  114,
                  111,
                  99,
                  101,
                  101,
                  100,
                  115,
                  95,
                  118,
                  97,
                  117,
                  108,
                  116,
                  95,
                  97,
                  117,
                  116,
                  104,
                  111,
                  114,
                  105,
                  116,
                  121
                ]
              },
              {
                "kind": "account",
                "path": "listingSettlement"
              }
            ]
          }
        },
        {
          "name": "authorProceedsVault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  97,
                  117,
                  116,
                  104,
                  111,
                  114,
                  95,
                  112,
                  114,
                  111,
                  99,
                  101,
                  101,
                  100,
                  115,
                  95,
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "listingSettlement"
              }
            ]
          }
        },
        {
          "name": "author",
          "writable": true,
          "signer": true
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": []
    },
    {
      "name": "linkVouchToListing",
      "discriminator": [
        202,
        154,
        2,
        164,
        144,
        248,
        53,
        191
      ],
      "accounts": [
        {
          "name": "skillListing",
          "writable": true
        },
        {
          "name": "listingVouchPosition",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  108,
                  105,
                  115,
                  116,
                  105,
                  110,
                  103,
                  95,
                  118,
                  111,
                  117,
                  99,
                  104,
                  95,
                  112,
                  111,
                  115,
                  105,
                  116,
                  105,
                  111,
                  110
                ]
              },
              {
                "kind": "account",
                "path": "skillListing"
              },
              {
                "kind": "account",
                "path": "vouch"
              }
            ]
          }
        },
        {
          "name": "vouch",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  111,
                  117,
                  99,
                  104
                ]
              },
              {
                "kind": "account",
                "path": "voucherProfile"
              },
              {
                "kind": "account",
                "path": "authorProfile"
              }
            ]
          }
        },
        {
          "name": "voucherProfile",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  97,
                  103,
                  101,
                  110,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "voucher"
              }
            ]
          }
        },
        {
          "name": "authorProfile",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  97,
                  103,
                  101,
                  110,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "skill_listing.author",
                "account": "skillListing"
              }
            ]
          }
        },
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "voucher",
          "writable": true,
          "signer": true
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": []
    },
    {
      "name": "migrateConfigM13",
      "discriminator": [
        239,
        110,
        59,
        208,
        142,
        49,
        55,
        238
      ],
      "accounts": [
        {
          "name": "config",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "payer",
          "writable": true,
          "signer": true
        },
        {
          "name": "authority",
          "signer": true
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": []
    },
    {
      "name": "migrateSkillListingM13",
      "discriminator": [
        39,
        254,
        23,
        99,
        65,
        215,
        46,
        103
      ],
      "accounts": [
        {
          "name": "skillListing",
          "writable": true
        },
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "usdcMint"
        },
        {
          "name": "listingSettlement",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  108,
                  105,
                  115,
                  116,
                  105,
                  110,
                  103,
                  95,
                  115,
                  101,
                  116,
                  116,
                  108,
                  101,
                  109,
                  101,
                  110,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "skillListing"
              },
              {
                "kind": "const",
                "value": [
                  0,
                  0,
                  0,
                  0,
                  0,
                  0,
                  0,
                  0
                ]
              }
            ]
          }
        },
        {
          "name": "authorProceedsVaultAuthority",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  97,
                  117,
                  116,
                  104,
                  111,
                  114,
                  95,
                  112,
                  114,
                  111,
                  99,
                  101,
                  101,
                  100,
                  115,
                  95,
                  118,
                  97,
                  117,
                  108,
                  116,
                  95,
                  97,
                  117,
                  116,
                  104,
                  111,
                  114,
                  105,
                  116,
                  121
                ]
              },
              {
                "kind": "account",
                "path": "listingSettlement"
              }
            ]
          }
        },
        {
          "name": "authorProceedsVault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  97,
                  117,
                  116,
                  104,
                  111,
                  114,
                  95,
                  112,
                  114,
                  111,
                  99,
                  101,
                  101,
                  100,
                  115,
                  95,
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "listingSettlement"
              }
            ]
          }
        },
        {
          "name": "payer",
          "writable": true,
          "signer": true
        },
        {
          "name": "authority",
          "signer": true
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": []
    },
    {
      "name": "openAuthorDispute",
      "discriminator": [
        37,
        162,
        204,
        185,
        218,
        143,
        241,
        119
      ],
      "accounts": [
        {
          "name": "authorDispute",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  97,
                  117,
                  116,
                  104,
                  111,
                  114,
                  95,
                  100,
                  105,
                  115,
                  112,
                  117,
                  116,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "author_profile.authority",
                "account": "agentProfile"
              },
              {
                "kind": "arg",
                "path": "disputeId"
              }
            ]
          }
        },
        {
          "name": "authorProfile",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  97,
                  103,
                  101,
                  110,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "author_profile.authority",
                "account": "agentProfile"
              }
            ]
          }
        },
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "skillListing",
          "writable": true
        },
        {
          "name": "purchase",
          "optional": true
        },
        {
          "name": "listingSettlement",
          "writable": true,
          "optional": true
        },
        {
          "name": "usdcMint"
        },
        {
          "name": "challengerUsdcAccount",
          "writable": true
        },
        {
          "name": "disputeBondVaultAuthority",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  100,
                  105,
                  115,
                  112,
                  117,
                  116,
                  101,
                  95,
                  98,
                  111,
                  110,
                  100,
                  95,
                  118,
                  97,
                  117,
                  108,
                  116,
                  95,
                  97,
                  117,
                  116,
                  104,
                  111,
                  114,
                  105,
                  116,
                  121
                ]
              },
              {
                "kind": "account",
                "path": "author_profile.authority",
                "account": "agentProfile"
              },
              {
                "kind": "arg",
                "path": "disputeId"
              }
            ]
          }
        },
        {
          "name": "disputeBondVault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  100,
                  105,
                  115,
                  112,
                  117,
                  116,
                  101,
                  95,
                  98,
                  111,
                  110,
                  100,
                  95,
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "author_profile.authority",
                "account": "agentProfile"
              },
              {
                "kind": "arg",
                "path": "disputeId"
              }
            ]
          }
        },
        {
          "name": "challenger",
          "writable": true,
          "signer": true
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "disputeId",
          "type": "u64"
        },
        {
          "name": "reason",
          "type": {
            "defined": {
              "name": "authorDisputeReason"
            }
          }
        },
        {
          "name": "evidenceUri",
          "type": "string"
        }
      ]
    },
    {
      "name": "purchaseSkill",
      "discriminator": [
        70,
        41,
        105,
        156,
        159,
        169,
        215,
        188
      ],
      "accounts": [
        {
          "name": "skillListing",
          "writable": true
        },
        {
          "name": "purchase",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  117,
                  114,
                  99,
                  104,
                  97,
                  115,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "buyer"
              },
              {
                "kind": "account",
                "path": "skillListing"
              },
              {
                "kind": "account",
                "path": "skill_listing.current_revision",
                "account": "skillListing"
              }
            ]
          }
        },
        {
          "name": "author"
        },
        {
          "name": "authorProfile",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  97,
                  103,
                  101,
                  110,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "skill_listing.author",
                "account": "skillListing"
              }
            ]
          }
        },
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "usdcMint"
        },
        {
          "name": "buyerUsdcAccount",
          "writable": true
        },
        {
          "name": "listingSettlement",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  108,
                  105,
                  115,
                  116,
                  105,
                  110,
                  103,
                  95,
                  115,
                  101,
                  116,
                  116,
                  108,
                  101,
                  109,
                  101,
                  110,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "skillListing"
              },
              {
                "kind": "account",
                "path": "skill_listing.current_revision",
                "account": "skillListing"
              }
            ]
          }
        },
        {
          "name": "authorProceedsVaultAuthority",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  97,
                  117,
                  116,
                  104,
                  111,
                  114,
                  95,
                  112,
                  114,
                  111,
                  99,
                  101,
                  101,
                  100,
                  115,
                  95,
                  118,
                  97,
                  117,
                  108,
                  116,
                  95,
                  97,
                  117,
                  116,
                  104,
                  111,
                  114,
                  105,
                  116,
                  121
                ]
              },
              {
                "kind": "account",
                "path": "listingSettlement"
              }
            ]
          }
        },
        {
          "name": "authorProceedsVault",
          "writable": true
        },
        {
          "name": "authorRewardVaultAuthority",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  97,
                  117,
                  116,
                  104,
                  111,
                  114,
                  95,
                  114,
                  101,
                  119,
                  97,
                  114,
                  100,
                  95,
                  118,
                  97,
                  117,
                  108,
                  116,
                  95,
                  97,
                  117,
                  116,
                  104,
                  111,
                  114,
                  105,
                  116,
                  121
                ]
              },
              {
                "kind": "account",
                "path": "authorProfile"
              }
            ]
          }
        },
        {
          "name": "authorRewardVault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  97,
                  117,
                  116,
                  104,
                  111,
                  114,
                  95,
                  114,
                  101,
                  119,
                  97,
                  114,
                  100,
                  95,
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "authorProfile"
              }
            ]
          }
        },
        {
          "name": "buyer",
          "writable": true,
          "signer": true
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": []
    },
    {
      "name": "registerAgent",
      "discriminator": [
        135,
        157,
        66,
        195,
        2,
        113,
        175,
        30
      ],
      "accounts": [
        {
          "name": "agentProfile",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  97,
                  103,
                  101,
                  110,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "authority"
              }
            ]
          }
        },
        {
          "name": "authority",
          "writable": true,
          "signer": true
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "metadataUri",
          "type": "string"
        }
      ]
    },
    {
      "name": "removeSkillListing",
      "discriminator": [
        196,
        216,
        174,
        251,
        211,
        35,
        48,
        33
      ],
      "accounts": [
        {
          "name": "skillListing",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  115,
                  107,
                  105,
                  108,
                  108
                ]
              },
              {
                "kind": "account",
                "path": "author"
              },
              {
                "kind": "arg",
                "path": "skillId"
              }
            ]
          }
        },
        {
          "name": "authorProfile",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  97,
                  103,
                  101,
                  110,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "author"
              }
            ]
          }
        },
        {
          "name": "author",
          "writable": true,
          "signer": true
        }
      ],
      "args": [
        {
          "name": "skillId",
          "type": "string"
        }
      ]
    },
    {
      "name": "resolveAuthorDispute",
      "discriminator": [
        104,
        27,
        60,
        182,
        26,
        232,
        213,
        247
      ],
      "accounts": [
        {
          "name": "authorDispute",
          "writable": true
        },
        {
          "name": "authorProfile",
          "writable": true
        },
        {
          "name": "skillListing",
          "writable": true
        },
        {
          "name": "config"
        },
        {
          "name": "authority",
          "signer": true
        },
        {
          "name": "usdcMint"
        },
        {
          "name": "disputeBondVaultAuthority"
        },
        {
          "name": "disputeBondVault",
          "writable": true
        },
        {
          "name": "protocolTreasuryVault",
          "writable": true
        },
        {
          "name": "listingSettlement",
          "writable": true,
          "optional": true
        },
        {
          "name": "authorBondVaultAuthority"
        },
        {
          "name": "challenger"
        },
        {
          "name": "challengerUsdcAccount",
          "writable": true
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        }
      ],
      "args": [
        {
          "name": "disputeId",
          "type": "u64"
        },
        {
          "name": "ruling",
          "type": {
            "defined": {
              "name": "authorDisputeRuling"
            }
          }
        }
      ]
    },
    {
      "name": "revokeVouch",
      "discriminator": [
        166,
        31,
        99,
        31,
        23,
        223,
        96,
        78
      ],
      "accounts": [
        {
          "name": "vouch",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  111,
                  117,
                  99,
                  104
                ]
              },
              {
                "kind": "account",
                "path": "voucherProfile"
              },
              {
                "kind": "account",
                "path": "voucheeProfile"
              }
            ]
          }
        },
        {
          "name": "voucherProfile",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  97,
                  103,
                  101,
                  110,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "voucher"
              }
            ]
          }
        },
        {
          "name": "voucheeProfile",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  97,
                  103,
                  101,
                  110,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "vouchee_profile.authority",
                "account": "agentProfile"
              }
            ]
          }
        },
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "usdcMint"
        },
        {
          "name": "vouchVaultAuthority",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  111,
                  117,
                  99,
                  104,
                  95,
                  118,
                  97,
                  117,
                  108,
                  116,
                  95,
                  97,
                  117,
                  116,
                  104,
                  111,
                  114,
                  105,
                  116,
                  121
                ]
              },
              {
                "kind": "account",
                "path": "voucherProfile"
              },
              {
                "kind": "account",
                "path": "voucheeProfile"
              }
            ]
          }
        },
        {
          "name": "vouchVault",
          "writable": true
        },
        {
          "name": "voucherUsdcAccount",
          "writable": true
        },
        {
          "name": "voucher",
          "writable": true,
          "signer": true
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        }
      ],
      "args": []
    },
    {
      "name": "settleX402Purchase",
      "discriminator": [
        33,
        34,
        100,
        136,
        204,
        68,
        180,
        1
      ],
      "accounts": [
        {
          "name": "skillListing",
          "writable": true
        },
        {
          "name": "purchase",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  117,
                  114,
                  99,
                  104,
                  97,
                  115,
                  101
                ]
              },
              {
                "kind": "arg",
                "path": "buyer"
              },
              {
                "kind": "account",
                "path": "skillListing"
              },
              {
                "kind": "account",
                "path": "skill_listing.current_revision",
                "account": "skillListing"
              }
            ]
          }
        },
        {
          "name": "author"
        },
        {
          "name": "authorProfile",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  97,
                  103,
                  101,
                  110,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "skill_listing.author",
                "account": "skillListing"
              }
            ]
          }
        },
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "usdcMint"
        },
        {
          "name": "x402SettlementVaultAuthority",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  120,
                  52,
                  48,
                  50,
                  95,
                  115,
                  101,
                  116,
                  116,
                  108,
                  101,
                  109,
                  101,
                  110,
                  116,
                  95,
                  118,
                  97,
                  117,
                  108,
                  116,
                  95,
                  97,
                  117,
                  116,
                  104,
                  111,
                  114,
                  105,
                  116,
                  121
                ]
              }
            ]
          }
        },
        {
          "name": "x402SettlementVault",
          "writable": true
        },
        {
          "name": "listingSettlement",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  108,
                  105,
                  115,
                  116,
                  105,
                  110,
                  103,
                  95,
                  115,
                  101,
                  116,
                  116,
                  108,
                  101,
                  109,
                  101,
                  110,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "skillListing"
              },
              {
                "kind": "account",
                "path": "skill_listing.current_revision",
                "account": "skillListing"
              }
            ]
          }
        },
        {
          "name": "authorProceedsVaultAuthority",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  97,
                  117,
                  116,
                  104,
                  111,
                  114,
                  95,
                  112,
                  114,
                  111,
                  99,
                  101,
                  101,
                  100,
                  115,
                  95,
                  118,
                  97,
                  117,
                  108,
                  116,
                  95,
                  97,
                  117,
                  116,
                  104,
                  111,
                  114,
                  105,
                  116,
                  121
                ]
              },
              {
                "kind": "account",
                "path": "listingSettlement"
              }
            ]
          }
        },
        {
          "name": "authorProceedsVault",
          "writable": true
        },
        {
          "name": "authorRewardVaultAuthority",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  97,
                  117,
                  116,
                  104,
                  111,
                  114,
                  95,
                  114,
                  101,
                  119,
                  97,
                  114,
                  100,
                  95,
                  118,
                  97,
                  117,
                  108,
                  116,
                  95,
                  97,
                  117,
                  116,
                  104,
                  111,
                  114,
                  105,
                  116,
                  121
                ]
              },
              {
                "kind": "account",
                "path": "authorProfile"
              }
            ]
          }
        },
        {
          "name": "authorRewardVault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  97,
                  117,
                  116,
                  104,
                  111,
                  114,
                  95,
                  114,
                  101,
                  119,
                  97,
                  114,
                  100,
                  95,
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "authorProfile"
              }
            ]
          }
        },
        {
          "name": "x402SettlementReceipt",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  120,
                  52,
                  48,
                  50,
                  95,
                  115,
                  101,
                  116,
                  116,
                  108,
                  101,
                  109,
                  101,
                  110,
                  116,
                  95,
                  114,
                  101,
                  99,
                  101,
                  105,
                  112,
                  116
                ]
              },
              {
                "kind": "arg",
                "path": "paymentRefHash"
              }
            ]
          }
        },
        {
          "name": "x402SettlementSignatureGuard",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  120,
                  52,
                  48,
                  50,
                  95,
                  115,
                  101,
                  116,
                  116,
                  108,
                  101,
                  109,
                  101,
                  110,
                  116,
                  95,
                  115,
                  105,
                  103,
                  110,
                  97,
                  116,
                  117,
                  114,
                  101
                ]
              },
              {
                "kind": "arg",
                "path": "settlementTxSignatureHash"
              }
            ]
          }
        },
        {
          "name": "settlementAuthority",
          "writable": true,
          "signer": true
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "paymentRefHash",
          "type": {
            "array": [
              "u8",
              32
            ]
          }
        },
        {
          "name": "settlementTxSignatureHash",
          "type": {
            "array": [
              "u8",
              32
            ]
          }
        },
        {
          "name": "buyer",
          "type": "pubkey"
        },
        {
          "name": "amountUsdcMicros",
          "type": "u64"
        }
      ]
    },
    {
      "name": "slashDisputeVouches",
      "discriminator": [
        147,
        175,
        122,
        126,
        201,
        40,
        216,
        32
      ],
      "accounts": [
        {
          "name": "authorDispute",
          "writable": true
        },
        {
          "name": "authorProfile",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  97,
                  103,
                  101,
                  110,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "author_profile.authority",
                "account": "agentProfile"
              }
            ]
          }
        },
        {
          "name": "skillListing",
          "writable": true
        },
        {
          "name": "listingSettlement",
          "writable": true
        },
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "usdcMint"
        },
        {
          "name": "authorProceedsVault",
          "writable": true
        },
        {
          "name": "cranker",
          "docs": [
            "Permissionless: anyone may crank a recorded ruling. The cranker only",
            "pays rent for the dispute-vouch-link accounts."
          ],
          "writable": true,
          "signer": true
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": []
    },
    {
      "name": "unlinkVouchFromListing",
      "discriminator": [
        28,
        208,
        119,
        150,
        170,
        237,
        104,
        37
      ],
      "accounts": [
        {
          "name": "skillListing",
          "writable": true
        },
        {
          "name": "listingVouchPosition",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  108,
                  105,
                  115,
                  116,
                  105,
                  110,
                  103,
                  95,
                  118,
                  111,
                  117,
                  99,
                  104,
                  95,
                  112,
                  111,
                  115,
                  105,
                  116,
                  105,
                  111,
                  110
                ]
              },
              {
                "kind": "account",
                "path": "skillListing"
              },
              {
                "kind": "account",
                "path": "vouch"
              }
            ]
          }
        },
        {
          "name": "vouch",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  111,
                  117,
                  99,
                  104
                ]
              },
              {
                "kind": "account",
                "path": "voucherProfile"
              },
              {
                "kind": "account",
                "path": "authorProfile"
              }
            ]
          }
        },
        {
          "name": "voucherProfile",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  97,
                  103,
                  101,
                  110,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "voucher"
              }
            ]
          }
        },
        {
          "name": "authorProfile",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  97,
                  103,
                  101,
                  110,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "skill_listing.author",
                "account": "skillListing"
              }
            ]
          }
        },
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "voucher",
          "signer": true
        }
      ],
      "args": []
    },
    {
      "name": "updateSkillListing",
      "discriminator": [
        192,
        205,
        6,
        209,
        45,
        93,
        143,
        10
      ],
      "accounts": [
        {
          "name": "skillListing",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  115,
                  107,
                  105,
                  108,
                  108
                ]
              },
              {
                "kind": "account",
                "path": "author"
              },
              {
                "kind": "arg",
                "path": "skillId"
              }
            ]
          }
        },
        {
          "name": "authorProfile",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  97,
                  103,
                  101,
                  110,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "author"
              }
            ]
          }
        },
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "authorBond",
          "optional": true
        },
        {
          "name": "author",
          "signer": true
        }
      ],
      "args": [
        {
          "name": "skillId",
          "type": "string"
        },
        {
          "name": "skillUri",
          "type": "string"
        },
        {
          "name": "name",
          "type": "string"
        },
        {
          "name": "description",
          "type": "string"
        },
        {
          "name": "priceUsdcMicros",
          "type": "u64"
        }
      ]
    },
    {
      "name": "vouch",
      "discriminator": [
        87,
        240,
        8,
        21,
        219,
        179,
        242,
        177
      ],
      "accounts": [
        {
          "name": "vouch",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  111,
                  117,
                  99,
                  104
                ]
              },
              {
                "kind": "account",
                "path": "voucherProfile"
              },
              {
                "kind": "account",
                "path": "voucheeProfile"
              }
            ]
          }
        },
        {
          "name": "voucherProfile",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  97,
                  103,
                  101,
                  110,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "voucher"
              }
            ]
          }
        },
        {
          "name": "voucheeProfile",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  97,
                  103,
                  101,
                  110,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "vouchee_profile.authority",
                "account": "agentProfile"
              }
            ]
          }
        },
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "usdcMint"
        },
        {
          "name": "voucherUsdcAccount",
          "writable": true
        },
        {
          "name": "vouchVaultAuthority",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  111,
                  117,
                  99,
                  104,
                  95,
                  118,
                  97,
                  117,
                  108,
                  116,
                  95,
                  97,
                  117,
                  116,
                  104,
                  111,
                  114,
                  105,
                  116,
                  121
                ]
              },
              {
                "kind": "account",
                "path": "voucherProfile"
              },
              {
                "kind": "account",
                "path": "voucheeProfile"
              }
            ]
          }
        },
        {
          "name": "vouchVault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  111,
                  117,
                  99,
                  104,
                  95,
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "voucherProfile"
              },
              {
                "kind": "account",
                "path": "voucheeProfile"
              }
            ]
          }
        },
        {
          "name": "authorRewardVaultAuthority",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  97,
                  117,
                  116,
                  104,
                  111,
                  114,
                  95,
                  114,
                  101,
                  119,
                  97,
                  114,
                  100,
                  95,
                  118,
                  97,
                  117,
                  108,
                  116,
                  95,
                  97,
                  117,
                  116,
                  104,
                  111,
                  114,
                  105,
                  116,
                  121
                ]
              },
              {
                "kind": "account",
                "path": "voucheeProfile"
              }
            ]
          }
        },
        {
          "name": "authorRewardVault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  97,
                  117,
                  116,
                  104,
                  111,
                  114,
                  95,
                  114,
                  101,
                  119,
                  97,
                  114,
                  100,
                  95,
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "voucheeProfile"
              }
            ]
          }
        },
        {
          "name": "voucher",
          "writable": true,
          "signer": true
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "stakeUsdcMicros",
          "type": "u64"
        }
      ]
    },
    {
      "name": "withdrawAuthorBond",
      "discriminator": [
        153,
        203,
        38,
        142,
        135,
        67,
        201,
        179
      ],
      "accounts": [
        {
          "name": "authorBond",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  97,
                  117,
                  116,
                  104,
                  111,
                  114,
                  95,
                  98,
                  111,
                  110,
                  100
                ]
              },
              {
                "kind": "account",
                "path": "author"
              }
            ]
          }
        },
        {
          "name": "authorProfile",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  97,
                  103,
                  101,
                  110,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "author"
              }
            ]
          }
        },
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "usdcMint"
        },
        {
          "name": "authorBondVaultAuthority",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  97,
                  117,
                  116,
                  104,
                  111,
                  114,
                  95,
                  98,
                  111,
                  110,
                  100,
                  95,
                  118,
                  97,
                  117,
                  108,
                  116,
                  95,
                  97,
                  117,
                  116,
                  104,
                  111,
                  114,
                  105,
                  116,
                  121
                ]
              },
              {
                "kind": "account",
                "path": "author"
              }
            ]
          }
        },
        {
          "name": "authorBondVault",
          "writable": true
        },
        {
          "name": "authorUsdcAccount",
          "writable": true
        },
        {
          "name": "author",
          "writable": true,
          "signer": true
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        }
      ],
      "args": [
        {
          "name": "amountUsdcMicros",
          "type": "u64"
        }
      ]
    },
    {
      "name": "withdrawAuthorProceeds",
      "discriminator": [
        245,
        136,
        52,
        151,
        131,
        85,
        131,
        55
      ],
      "accounts": [
        {
          "name": "skillListing"
        },
        {
          "name": "listingSettlement",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  108,
                  105,
                  115,
                  116,
                  105,
                  110,
                  103,
                  95,
                  115,
                  101,
                  116,
                  116,
                  108,
                  101,
                  109,
                  101,
                  110,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "skillListing"
              },
              {
                "kind": "account",
                "path": "listing_settlement.revision",
                "account": "listingSettlement"
              }
            ]
          }
        },
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "usdcMint"
        },
        {
          "name": "authorProceedsVaultAuthority",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  97,
                  117,
                  116,
                  104,
                  111,
                  114,
                  95,
                  112,
                  114,
                  111,
                  99,
                  101,
                  101,
                  100,
                  115,
                  95,
                  118,
                  97,
                  117,
                  108,
                  116,
                  95,
                  97,
                  117,
                  116,
                  104,
                  111,
                  114,
                  105,
                  116,
                  121
                ]
              },
              {
                "kind": "account",
                "path": "listingSettlement"
              }
            ]
          }
        },
        {
          "name": "authorProceedsVault",
          "writable": true
        },
        {
          "name": "authorUsdcAccount",
          "writable": true
        },
        {
          "name": "author",
          "signer": true
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        }
      ],
      "args": [
        {
          "name": "amountUsdcMicros",
          "type": "u64"
        }
      ]
    }
  ],
  "accounts": [
    {
      "name": "agentProfile",
      "discriminator": [
        60,
        227,
        42,
        24,
        0,
        87,
        86,
        205
      ]
    },
    {
      "name": "authorBond",
      "discriminator": [
        179,
        13,
        148,
        157,
        91,
        243,
        120,
        251
      ]
    },
    {
      "name": "authorDispute",
      "discriminator": [
        241,
        8,
        1,
        66,
        88,
        235,
        140,
        242
      ]
    },
    {
      "name": "listingSettlement",
      "discriminator": [
        199,
        137,
        206,
        148,
        6,
        93,
        158,
        75
      ]
    },
    {
      "name": "listingVouchPosition",
      "discriminator": [
        2,
        163,
        255,
        106,
        125,
        56,
        3,
        146
      ]
    },
    {
      "name": "purchase",
      "discriminator": [
        33,
        203,
        1,
        252,
        231,
        228,
        8,
        67
      ]
    },
    {
      "name": "refundClaim",
      "discriminator": [
        141,
        131,
        251,
        43,
        14,
        187,
        12,
        52
      ]
    },
    {
      "name": "refundPool",
      "discriminator": [
        101,
        196,
        163,
        169,
        186,
        73,
        206,
        171
      ]
    },
    {
      "name": "reputationConfig",
      "discriminator": [
        46,
        222,
        226,
        114,
        243,
        60,
        242,
        75
      ]
    },
    {
      "name": "skillListing",
      "discriminator": [
        133,
        247,
        251,
        51,
        57,
        31,
        57,
        30
      ]
    },
    {
      "name": "vouch",
      "discriminator": [
        151,
        175,
        234,
        54,
        134,
        101,
        175,
        210
      ]
    },
    {
      "name": "x402SettlementReceipt",
      "discriminator": [
        110,
        6,
        154,
        54,
        214,
        71,
        138,
        246
      ]
    },
    {
      "name": "x402SettlementSignatureGuard",
      "discriminator": [
        100,
        135,
        137,
        55,
        214,
        211,
        155,
        149
      ]
    }
  ],
  "events": [
    {
      "name": "authorBondDeposited",
      "discriminator": [
        64,
        29,
        156,
        145,
        103,
        85,
        128,
        109
      ]
    },
    {
      "name": "authorBondSlashed",
      "discriminator": [
        130,
        211,
        170,
        231,
        166,
        39,
        233,
        90
      ]
    },
    {
      "name": "authorBondWithdrawn",
      "discriminator": [
        157,
        11,
        206,
        189,
        41,
        171,
        136,
        119
      ]
    },
    {
      "name": "authorDisputeOpened",
      "discriminator": [
        28,
        81,
        192,
        228,
        95,
        182,
        238,
        30
      ]
    },
    {
      "name": "authorDisputeResolved",
      "discriminator": [
        126,
        245,
        151,
        187,
        8,
        65,
        225,
        35
      ]
    },
    {
      "name": "authorDisputeSlashingFinalized",
      "discriminator": [
        178,
        8,
        34,
        143,
        107,
        61,
        197,
        99
      ]
    },
    {
      "name": "authorDisputeVouchLinked",
      "discriminator": [
        134,
        76,
        190,
        203,
        227,
        59,
        164,
        232
      ]
    },
    {
      "name": "authorProceedsWithdrawn",
      "discriminator": [
        183,
        18,
        26,
        22,
        216,
        248,
        206,
        72
      ]
    },
    {
      "name": "listingSettlementInitialized",
      "discriminator": [
        197,
        59,
        247,
        88,
        164,
        73,
        99,
        210
      ]
    },
    {
      "name": "listingVouchPositionLinked",
      "discriminator": [
        26,
        43,
        223,
        38,
        30,
        24,
        20,
        149
      ]
    },
    {
      "name": "listingVouchPositionUnlinked",
      "discriminator": [
        118,
        128,
        70,
        50,
        15,
        195,
        103,
        149
      ]
    },
    {
      "name": "purchaseRefundClaimed",
      "discriminator": [
        41,
        62,
        155,
        251,
        206,
        237,
        18,
        81
      ]
    },
    {
      "name": "refundPoolCreated",
      "discriminator": [
        173,
        232,
        62,
        89,
        146,
        98,
        84,
        220
      ]
    },
    {
      "name": "revenueClaimed",
      "discriminator": [
        5,
        254,
        104,
        87,
        133,
        137,
        45,
        116
      ]
    },
    {
      "name": "skillListingCreated",
      "discriminator": [
        70,
        77,
        153,
        20,
        48,
        144,
        124,
        224
      ]
    },
    {
      "name": "skillListingUpdated",
      "discriminator": [
        15,
        130,
        53,
        156,
        202,
        204,
        118,
        7
      ]
    },
    {
      "name": "skillPurchased",
      "discriminator": [
        90,
        255,
        155,
        123,
        29,
        16,
        39,
        75
      ]
    },
    {
      "name": "vouchCreated",
      "discriminator": [
        127,
        98,
        245,
        5,
        1,
        172,
        112,
        42
      ]
    },
    {
      "name": "vouchRevoked",
      "discriminator": [
        229,
        20,
        21,
        98,
        75,
        95,
        120,
        64
      ]
    },
    {
      "name": "voucherSlashed",
      "discriminator": [
        81,
        37,
        95,
        2,
        46,
        178,
        209,
        201
      ]
    },
    {
      "name": "x402PurchaseSettled",
      "discriminator": [
        41,
        241,
        34,
        116,
        76,
        3,
        68,
        193
      ]
    }
  ],
  "errors": [
    {
      "code": 6000,
      "name": "protocolPaused",
      "msg": "Protocol is paused"
    },
    {
      "code": 6001,
      "name": "notAuthor",
      "msg": "Only the listing author can withdraw proceeds"
    },
    {
      "code": 6002,
      "name": "invalidAmount",
      "msg": "Withdrawal amount must be positive"
    },
    {
      "code": 6003,
      "name": "settlementMismatch",
      "msg": "Listing settlement account does not match the listing"
    },
    {
      "code": 6004,
      "name": "authorProceedsVaultMismatch",
      "msg": "Author proceeds vault does not match settlement state"
    },
    {
      "code": 6005,
      "name": "proceedsLocked",
      "msg": "Author proceeds are still locked"
    },
    {
      "code": 6006,
      "name": "settlementLocked",
      "msg": "Author proceeds are locked by an open dispute"
    },
    {
      "code": 6007,
      "name": "insufficientWithdrawableProceeds",
      "msg": "Insufficient withdrawable author proceeds"
    },
    {
      "code": 6008,
      "name": "lockOverflow",
      "msg": "Author proceeds lock calculation overflowed"
    },
    {
      "code": 6009,
      "name": "withdrawalOverflow",
      "msg": "Withdrawal accounting overflowed"
    },
    {
      "code": 6010,
      "name": "invalidUsdcMint",
      "msg": "USDC mint does not match config"
    },
    {
      "code": 6011,
      "name": "invalidTokenMint",
      "msg": "Token account mint does not match config"
    },
    {
      "code": 6012,
      "name": "invalidTokenOwner",
      "msg": "Token account owner is invalid"
    }
  ],
  "types": [
    {
      "name": "agentProfile",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "authority",
            "type": "pubkey"
          },
          {
            "name": "metadataUri",
            "type": "string"
          },
          {
            "name": "reputationScore",
            "type": "u64"
          },
          {
            "name": "totalVouchesReceived",
            "type": "u32"
          },
          {
            "name": "totalVouchesGiven",
            "type": "u32"
          },
          {
            "name": "totalVouchStakeUsdcMicros",
            "type": "u64"
          },
          {
            "name": "authorBondUsdcMicros",
            "type": "u64"
          },
          {
            "name": "activeFreeSkillListings",
            "type": "u32"
          },
          {
            "name": "openAuthorDisputes",
            "type": "u32"
          },
          {
            "name": "upheldAuthorDisputes",
            "type": "u32"
          },
          {
            "name": "dismissedAuthorDisputes",
            "type": "u32"
          },
          {
            "name": "rewardVault",
            "type": "pubkey"
          },
          {
            "name": "rewardVaultRentPayer",
            "type": "pubkey"
          },
          {
            "name": "rewardIndexUsdcMicrosX1e12",
            "type": "u128"
          },
          {
            "name": "unclaimedVoucherRevenueUsdcMicros",
            "type": "u64"
          },
          {
            "name": "registeredAt",
            "type": "i64"
          },
          {
            "name": "bump",
            "type": "u8"
          },
          {
            "name": "rewardVaultBump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "authorBond",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "author",
            "type": "pubkey"
          },
          {
            "name": "vault",
            "type": "pubkey"
          },
          {
            "name": "rentPayer",
            "type": "pubkey"
          },
          {
            "name": "amountUsdcMicros",
            "type": "u64"
          },
          {
            "name": "createdAt",
            "type": "i64"
          },
          {
            "name": "updatedAt",
            "type": "i64"
          },
          {
            "name": "bump",
            "type": "u8"
          },
          {
            "name": "vaultBump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "authorBondDeposited",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "authorBond",
            "type": "pubkey"
          },
          {
            "name": "author",
            "type": "pubkey"
          },
          {
            "name": "amountUsdcMicros",
            "type": "u64"
          },
          {
            "name": "totalBondUsdcMicros",
            "type": "u64"
          },
          {
            "name": "vault",
            "type": "pubkey"
          },
          {
            "name": "timestamp",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "authorBondSlashed",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "authorBond",
            "type": "pubkey"
          },
          {
            "name": "author",
            "type": "pubkey"
          },
          {
            "name": "amountUsdcMicros",
            "type": "u64"
          },
          {
            "name": "remainingBondUsdcMicros",
            "type": "u64"
          },
          {
            "name": "timestamp",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "authorBondWithdrawn",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "authorBond",
            "type": "pubkey"
          },
          {
            "name": "author",
            "type": "pubkey"
          },
          {
            "name": "amountUsdcMicros",
            "type": "u64"
          },
          {
            "name": "totalBondUsdcMicros",
            "type": "u64"
          },
          {
            "name": "timestamp",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "authorDispute",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "disputeId",
            "type": "u64"
          },
          {
            "name": "author",
            "type": "pubkey"
          },
          {
            "name": "challenger",
            "type": "pubkey"
          },
          {
            "name": "disputeBondVault",
            "type": "pubkey"
          },
          {
            "name": "rentPayer",
            "type": "pubkey"
          },
          {
            "name": "reason",
            "type": {
              "defined": {
                "name": "authorDisputeReason"
              }
            }
          },
          {
            "name": "evidenceUri",
            "type": "string"
          },
          {
            "name": "status",
            "type": {
              "defined": {
                "name": "authorDisputeStatus"
              }
            }
          },
          {
            "name": "ruling",
            "type": {
              "option": {
                "defined": {
                  "name": "authorDisputeRuling"
                }
              }
            }
          },
          {
            "name": "liabilityScope",
            "type": {
              "defined": {
                "name": "authorDisputeLiabilityScope"
              }
            }
          },
          {
            "name": "skillListing",
            "type": "pubkey"
          },
          {
            "name": "skillPriceUsdcMicrosSnapshot",
            "type": "u64"
          },
          {
            "name": "purchase",
            "type": {
              "option": "pubkey"
            }
          },
          {
            "name": "backingVouchCountSnapshot",
            "type": "u32"
          },
          {
            "name": "linkedVouchCount",
            "type": "u32"
          },
          {
            "name": "processedVouchCount",
            "type": "u32"
          },
          {
            "name": "authorBondSlashedUsdcMicros",
            "type": "u64"
          },
          {
            "name": "voucherSlashedUsdcMicros",
            "type": "u64"
          },
          {
            "name": "bondAmountUsdcMicros",
            "type": "u64"
          },
          {
            "name": "createdAt",
            "type": "i64"
          },
          {
            "name": "resolvedAt",
            "type": {
              "option": "i64"
            }
          },
          {
            "name": "bump",
            "type": "u8"
          },
          {
            "name": "disputeBondVaultBump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "authorDisputeLiabilityScope",
      "type": {
        "kind": "enum",
        "variants": [
          {
            "name": "authorBondOnly"
          },
          {
            "name": "authorBondThenVouchers"
          }
        ]
      }
    },
    {
      "name": "authorDisputeOpened",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "authorDispute",
            "type": "pubkey"
          },
          {
            "name": "author",
            "type": "pubkey"
          },
          {
            "name": "challenger",
            "type": "pubkey"
          },
          {
            "name": "reason",
            "type": "string"
          },
          {
            "name": "liabilityScope",
            "type": "string"
          },
          {
            "name": "skillListing",
            "type": "pubkey"
          },
          {
            "name": "skillPriceUsdcMicrosSnapshot",
            "type": "u64"
          },
          {
            "name": "purchase",
            "type": {
              "option": "pubkey"
            }
          },
          {
            "name": "linkedVouchCount",
            "type": "u32"
          },
          {
            "name": "bondAmountUsdcMicros",
            "type": "u64"
          },
          {
            "name": "disputeBondVault",
            "type": "pubkey"
          },
          {
            "name": "timestamp",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "authorDisputeReason",
      "type": {
        "kind": "enum",
        "variants": [
          {
            "name": "maliciousSkill"
          },
          {
            "name": "fraudulentClaims"
          },
          {
            "name": "failedDelivery"
          },
          {
            "name": "other"
          }
        ]
      }
    },
    {
      "name": "authorDisputeResolved",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "authorDispute",
            "type": "pubkey"
          },
          {
            "name": "author",
            "type": "pubkey"
          },
          {
            "name": "ruling",
            "type": "string"
          },
          {
            "name": "liabilityScope",
            "type": "string"
          },
          {
            "name": "linkedVouchCount",
            "type": "u32"
          },
          {
            "name": "authorBondSlashedUsdcMicros",
            "type": "u64"
          },
          {
            "name": "voucherSlashedUsdcMicros",
            "type": "u64"
          },
          {
            "name": "slashedUsdcMicros",
            "type": "u64"
          },
          {
            "name": "timestamp",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "authorDisputeRuling",
      "type": {
        "kind": "enum",
        "variants": [
          {
            "name": "upheld"
          },
          {
            "name": "dismissed"
          }
        ]
      }
    },
    {
      "name": "authorDisputeSlashingFinalized",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "authorDispute",
            "type": "pubkey"
          },
          {
            "name": "author",
            "type": "pubkey"
          },
          {
            "name": "processedVouchCount",
            "type": "u32"
          },
          {
            "name": "voucherSlashedUsdcMicros",
            "type": "u64"
          },
          {
            "name": "timestamp",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "authorDisputeStatus",
      "type": {
        "kind": "enum",
        "variants": [
          {
            "name": "open"
          },
          {
            "name": "resolved"
          },
          {
            "name": "slashingVouchers"
          }
        ]
      }
    },
    {
      "name": "authorDisputeVouchLinked",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "authorDispute",
            "type": "pubkey"
          },
          {
            "name": "vouch",
            "type": "pubkey"
          },
          {
            "name": "timestamp",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "authorProceedsWithdrawn",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "skillListing",
            "type": "pubkey"
          },
          {
            "name": "listingSettlement",
            "type": "pubkey"
          },
          {
            "name": "author",
            "type": "pubkey"
          },
          {
            "name": "amountUsdcMicros",
            "type": "u64"
          },
          {
            "name": "remainingWithdrawableUsdcMicros",
            "type": "u64"
          },
          {
            "name": "timestamp",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "listingSettlement",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "skillListing",
            "type": "pubkey"
          },
          {
            "name": "author",
            "type": "pubkey"
          },
          {
            "name": "revision",
            "type": "u64"
          },
          {
            "name": "authorProceedsVault",
            "type": "pubkey"
          },
          {
            "name": "totalPurchases",
            "type": "u64"
          },
          {
            "name": "totalPurchaseUsdcMicros",
            "type": "u64"
          },
          {
            "name": "totalAuthorProceedsUsdcMicros",
            "type": "u64"
          },
          {
            "name": "withdrawableAuthorProceedsUsdcMicros",
            "type": "u64"
          },
          {
            "name": "withdrawnAuthorProceedsUsdcMicros",
            "type": "u64"
          },
          {
            "name": "refundedAuthorProceedsUsdcMicros",
            "type": "u64"
          },
          {
            "name": "slashedDepositUsdcMicros",
            "docs": [
              "Voucher stake slashed into the author proceeds vault by an upheld",
              "dispute. Ring-fenced: refund-pool-only, never author-withdrawable,",
              "excluded from the challenger reward base."
            ],
            "type": "u64"
          },
          {
            "name": "lockedByDispute",
            "type": {
              "option": "pubkey"
            }
          },
          {
            "name": "createdAt",
            "type": "i64"
          },
          {
            "name": "updatedAt",
            "type": "i64"
          },
          {
            "name": "bump",
            "type": "u8"
          },
          {
            "name": "authorProceedsVaultBump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "listingSettlementInitialized",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "skillListing",
            "type": "pubkey"
          },
          {
            "name": "listingSettlement",
            "type": "pubkey"
          },
          {
            "name": "author",
            "type": "pubkey"
          },
          {
            "name": "revision",
            "type": "u64"
          },
          {
            "name": "authorProceedsVault",
            "type": "pubkey"
          },
          {
            "name": "timestamp",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "listingVouchPosition",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "skillListing",
            "type": "pubkey"
          },
          {
            "name": "vouch",
            "type": "pubkey"
          },
          {
            "name": "voucher",
            "type": "pubkey"
          },
          {
            "name": "rewardStakeUsdcMicros",
            "type": "u64"
          },
          {
            "name": "entryRewardIndexX1e12",
            "type": "u128"
          },
          {
            "name": "pendingRewardsUsdcMicros",
            "type": "u64"
          },
          {
            "name": "cumulativeRevenueUsdcMicros",
            "type": "u64"
          },
          {
            "name": "status",
            "type": {
              "defined": {
                "name": "listingVouchPositionStatus"
              }
            }
          },
          {
            "name": "createdAt",
            "type": "i64"
          },
          {
            "name": "updatedAt",
            "type": "i64"
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "listingVouchPositionLinked",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "listingVouchPosition",
            "type": "pubkey"
          },
          {
            "name": "skillListing",
            "type": "pubkey"
          },
          {
            "name": "vouch",
            "type": "pubkey"
          },
          {
            "name": "voucher",
            "type": "pubkey"
          },
          {
            "name": "rewardStakeUsdcMicros",
            "type": "u64"
          },
          {
            "name": "timestamp",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "listingVouchPositionStatus",
      "type": {
        "kind": "enum",
        "variants": [
          {
            "name": "active"
          },
          {
            "name": "unlinked"
          },
          {
            "name": "slashed"
          }
        ]
      }
    },
    {
      "name": "listingVouchPositionUnlinked",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "listingVouchPosition",
            "type": "pubkey"
          },
          {
            "name": "skillListing",
            "type": "pubkey"
          },
          {
            "name": "vouch",
            "type": "pubkey"
          },
          {
            "name": "voucher",
            "type": "pubkey"
          },
          {
            "name": "pendingRewardsUsdcMicros",
            "type": "u64"
          },
          {
            "name": "timestamp",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "purchase",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "buyer",
            "type": "pubkey"
          },
          {
            "name": "skillListing",
            "type": "pubkey"
          },
          {
            "name": "purchasedAt",
            "type": "i64"
          },
          {
            "name": "listingRevision",
            "type": "u64"
          },
          {
            "name": "listingSettlement",
            "type": "pubkey"
          },
          {
            "name": "pricePaidUsdcMicros",
            "type": "u64"
          },
          {
            "name": "authorShareUsdcMicros",
            "type": "u64"
          },
          {
            "name": "voucherPoolUsdcMicros",
            "type": "u64"
          },
          {
            "name": "usdcMint",
            "type": "pubkey"
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "purchaseRefundClaimed",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "refundPool",
            "type": "pubkey"
          },
          {
            "name": "refundClaim",
            "type": "pubkey"
          },
          {
            "name": "purchase",
            "type": "pubkey"
          },
          {
            "name": "buyer",
            "type": "pubkey"
          },
          {
            "name": "amountUsdcMicros",
            "type": "u64"
          },
          {
            "name": "timestamp",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "refundClaim",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "refundPool",
            "type": "pubkey"
          },
          {
            "name": "purchase",
            "type": "pubkey"
          },
          {
            "name": "buyer",
            "type": "pubkey"
          },
          {
            "name": "amountUsdcMicros",
            "type": "u64"
          },
          {
            "name": "claimedAt",
            "type": "i64"
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "refundPool",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "authorDispute",
            "type": "pubkey"
          },
          {
            "name": "skillListing",
            "type": "pubkey"
          },
          {
            "name": "listingSettlement",
            "type": "pubkey"
          },
          {
            "name": "revision",
            "type": "u64"
          },
          {
            "name": "refundVault",
            "type": "pubkey"
          },
          {
            "name": "totalPoolUsdcMicros",
            "type": "u64"
          },
          {
            "name": "remainingPoolUsdcMicros",
            "type": "u64"
          },
          {
            "name": "claimedUsdcMicros",
            "type": "u64"
          },
          {
            "name": "maxRefundPerPurchaseUsdcMicros",
            "type": "u64"
          },
          {
            "name": "challengerRewardUsdcMicros",
            "type": "u64"
          },
          {
            "name": "claimDeadline",
            "type": {
              "option": "i64"
            }
          },
          {
            "name": "createdAt",
            "type": "i64"
          },
          {
            "name": "bump",
            "type": "u8"
          },
          {
            "name": "refundVaultBump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "refundPoolCreated",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "refundPool",
            "type": "pubkey"
          },
          {
            "name": "authorDispute",
            "type": "pubkey"
          },
          {
            "name": "skillListing",
            "type": "pubkey"
          },
          {
            "name": "listingSettlement",
            "type": "pubkey"
          },
          {
            "name": "revision",
            "type": "u64"
          },
          {
            "name": "totalPoolUsdcMicros",
            "type": "u64"
          },
          {
            "name": "challengerRewardUsdcMicros",
            "type": "u64"
          },
          {
            "name": "claimDeadline",
            "type": {
              "option": "i64"
            }
          },
          {
            "name": "timestamp",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "reputationConfig",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "authority",
            "type": "pubkey"
          },
          {
            "name": "configAuthority",
            "type": "pubkey"
          },
          {
            "name": "treasuryAuthority",
            "type": "pubkey"
          },
          {
            "name": "settlementAuthority",
            "type": "pubkey"
          },
          {
            "name": "pauseAuthority",
            "type": "pubkey"
          },
          {
            "name": "usdcMint",
            "type": "pubkey"
          },
          {
            "name": "tokenProgram",
            "type": "pubkey"
          },
          {
            "name": "protocolTreasuryVault",
            "type": "pubkey"
          },
          {
            "name": "x402SettlementVault",
            "type": "pubkey"
          },
          {
            "name": "chainContext",
            "type": "string"
          },
          {
            "name": "minVouchStakeUsdcMicros",
            "type": "u64"
          },
          {
            "name": "disputeBondUsdcMicros",
            "type": "u64"
          },
          {
            "name": "minAuthorBondForFreeListingUsdcMicros",
            "type": "u64"
          },
          {
            "name": "minPaidListingPriceUsdcMicros",
            "type": "u64"
          },
          {
            "name": "authorShareBps",
            "type": "u16"
          },
          {
            "name": "voucherShareBps",
            "type": "u16"
          },
          {
            "name": "protocolFeeBps",
            "type": "u16"
          },
          {
            "name": "slashPercentage",
            "type": "u8"
          },
          {
            "name": "cooldownPeriod",
            "type": "i64"
          },
          {
            "name": "stakeWeightPerUsdc",
            "type": "u32"
          },
          {
            "name": "riskComponentCap",
            "type": "u64"
          },
          {
            "name": "vouchWeight",
            "type": "u32"
          },
          {
            "name": "vouchComponentCap",
            "type": "u64"
          },
          {
            "name": "longevityBonusPerDay",
            "type": "u32"
          },
          {
            "name": "longevityComponentCap",
            "type": "u64"
          },
          {
            "name": "upheldDisputePenalty",
            "type": "u64"
          },
          {
            "name": "reputationScoreCap",
            "type": "u64"
          },
          {
            "name": "authorProceedsLockSeconds",
            "type": "i64"
          },
          {
            "name": "refundClaimWindowSeconds",
            "type": "i64"
          },
          {
            "name": "challengerRewardBps",
            "type": "u16"
          },
          {
            "name": "challengerRewardCapUsdcMicros",
            "type": "u64"
          },
          {
            "name": "paused",
            "type": "bool"
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "revenueClaimed",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "authorProfile",
            "type": "pubkey"
          },
          {
            "name": "authorRewardVault",
            "type": "pubkey"
          },
          {
            "name": "vouch",
            "type": "pubkey"
          },
          {
            "name": "voucher",
            "type": "pubkey"
          },
          {
            "name": "amountUsdcMicros",
            "type": "u64"
          },
          {
            "name": "timestamp",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "skillListing",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "author",
            "type": "pubkey"
          },
          {
            "name": "skillUri",
            "type": "string"
          },
          {
            "name": "name",
            "type": "string"
          },
          {
            "name": "description",
            "type": "string"
          },
          {
            "name": "priceUsdcMicros",
            "type": "u64"
          },
          {
            "name": "rewardVault",
            "type": "pubkey"
          },
          {
            "name": "rewardVaultRentPayer",
            "type": "pubkey"
          },
          {
            "name": "currentRevision",
            "type": "u64"
          },
          {
            "name": "currentSettlement",
            "type": "pubkey"
          },
          {
            "name": "currentAuthorProceedsVault",
            "type": "pubkey"
          },
          {
            "name": "totalDownloads",
            "type": "u64"
          },
          {
            "name": "totalRevenueUsdcMicros",
            "type": "u64"
          },
          {
            "name": "totalAuthorRevenueUsdcMicros",
            "type": "u64"
          },
          {
            "name": "totalVoucherRevenueUsdcMicros",
            "type": "u64"
          },
          {
            "name": "activeRewardStakeUsdcMicros",
            "type": "u64"
          },
          {
            "name": "activeRewardPositionCount",
            "type": "u32"
          },
          {
            "name": "rewardIndexUsdcMicrosX1e12",
            "type": "u128"
          },
          {
            "name": "unclaimedVoucherRevenueUsdcMicros",
            "type": "u64"
          },
          {
            "name": "createdAt",
            "type": "i64"
          },
          {
            "name": "updatedAt",
            "type": "i64"
          },
          {
            "name": "status",
            "type": {
              "defined": {
                "name": "skillStatus"
              }
            }
          },
          {
            "name": "lockedByDispute",
            "docs": [
              "Mirror of the current settlement's dispute lock, kept at the listing",
              "level so it survives settlement rotation: while set, vouch positions",
              "cannot be linked/unlinked, the revision cannot be bumped, and no new",
              "settlement can be initialized for this listing."
            ],
            "type": {
              "option": "pubkey"
            }
          },
          {
            "name": "bump",
            "type": "u8"
          },
          {
            "name": "rewardVaultBump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "skillListingCreated",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "skillListing",
            "type": "pubkey"
          },
          {
            "name": "author",
            "type": "pubkey"
          },
          {
            "name": "name",
            "type": "string"
          },
          {
            "name": "priceUsdcMicros",
            "type": "u64"
          },
          {
            "name": "rewardVault",
            "type": "pubkey"
          },
          {
            "name": "timestamp",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "skillListingUpdated",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "skillListing",
            "type": "pubkey"
          },
          {
            "name": "author",
            "type": "pubkey"
          },
          {
            "name": "name",
            "type": "string"
          },
          {
            "name": "priceUsdcMicros",
            "type": "u64"
          },
          {
            "name": "timestamp",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "skillPurchased",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "purchase",
            "type": "pubkey"
          },
          {
            "name": "skillListing",
            "type": "pubkey"
          },
          {
            "name": "buyer",
            "type": "pubkey"
          },
          {
            "name": "priceUsdcMicros",
            "type": "u64"
          },
          {
            "name": "authorShareUsdcMicros",
            "type": "u64"
          },
          {
            "name": "voucherPoolUsdcMicros",
            "type": "u64"
          },
          {
            "name": "listingRevision",
            "type": "u64"
          },
          {
            "name": "listingSettlement",
            "type": "pubkey"
          },
          {
            "name": "authorProceedsVault",
            "type": "pubkey"
          },
          {
            "name": "rewardVault",
            "type": "pubkey"
          },
          {
            "name": "timestamp",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "skillStatus",
      "type": {
        "kind": "enum",
        "variants": [
          {
            "name": "active"
          },
          {
            "name": "suspended"
          },
          {
            "name": "removed"
          }
        ]
      }
    },
    {
      "name": "vouch",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "voucher",
            "type": "pubkey"
          },
          {
            "name": "vouchee",
            "type": "pubkey"
          },
          {
            "name": "stakeUsdcMicros",
            "type": "u64"
          },
          {
            "name": "vault",
            "type": "pubkey"
          },
          {
            "name": "rentPayer",
            "type": "pubkey"
          },
          {
            "name": "createdAt",
            "type": "i64"
          },
          {
            "name": "status",
            "type": {
              "defined": {
                "name": "vouchStatus"
              }
            }
          },
          {
            "name": "cumulativeRevenueUsdcMicros",
            "type": "u64"
          },
          {
            "name": "linkedListingCount",
            "type": "u32"
          },
          {
            "name": "entryAuthorRewardIndexX1e12",
            "type": "u128"
          },
          {
            "name": "pendingRewardsUsdcMicros",
            "type": "u64"
          },
          {
            "name": "lastPayoutAt",
            "type": "i64"
          },
          {
            "name": "bump",
            "type": "u8"
          },
          {
            "name": "vaultBump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "vouchCreated",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "vouch",
            "type": "pubkey"
          },
          {
            "name": "voucher",
            "type": "pubkey"
          },
          {
            "name": "vouchee",
            "type": "pubkey"
          },
          {
            "name": "stakeUsdcMicros",
            "type": "u64"
          },
          {
            "name": "vault",
            "type": "pubkey"
          },
          {
            "name": "timestamp",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "vouchRevoked",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "vouch",
            "type": "pubkey"
          },
          {
            "name": "voucher",
            "type": "pubkey"
          },
          {
            "name": "vouchee",
            "type": "pubkey"
          },
          {
            "name": "stakeReturnedUsdcMicros",
            "type": "u64"
          },
          {
            "name": "timestamp",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "vouchStatus",
      "type": {
        "kind": "enum",
        "variants": [
          {
            "name": "active"
          },
          {
            "name": "revoked"
          },
          {
            "name": "slashed"
          }
        ]
      }
    },
    {
      "name": "voucherSlashed",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "authorDispute",
            "type": "pubkey"
          },
          {
            "name": "vouch",
            "type": "pubkey"
          },
          {
            "name": "voucher",
            "type": "pubkey"
          },
          {
            "name": "vouchee",
            "type": "pubkey"
          },
          {
            "name": "listingVouchPosition",
            "type": "pubkey"
          },
          {
            "name": "slashUsdcMicros",
            "type": "u64"
          },
          {
            "name": "residualStakeUsdcMicros",
            "type": "u64"
          },
          {
            "name": "timestamp",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "x402PurchaseSettled",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "receipt",
            "type": "pubkey"
          },
          {
            "name": "signatureGuard",
            "type": "pubkey"
          },
          {
            "name": "purchase",
            "type": "pubkey"
          },
          {
            "name": "skillListing",
            "type": "pubkey"
          },
          {
            "name": "buyer",
            "type": "pubkey"
          },
          {
            "name": "paymentRefHash",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "settlementTxSignatureHash",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "priceUsdcMicros",
            "type": "u64"
          },
          {
            "name": "authorShareUsdcMicros",
            "type": "u64"
          },
          {
            "name": "voucherPoolUsdcMicros",
            "type": "u64"
          },
          {
            "name": "listingRevision",
            "type": "u64"
          },
          {
            "name": "listingSettlement",
            "type": "pubkey"
          },
          {
            "name": "x402SettlementVault",
            "type": "pubkey"
          },
          {
            "name": "authorProceedsVault",
            "type": "pubkey"
          },
          {
            "name": "rewardVault",
            "type": "pubkey"
          },
          {
            "name": "timestamp",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "x402SettlementReceipt",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "paymentRefHash",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "settlementTxSignatureHash",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "buyer",
            "type": "pubkey"
          },
          {
            "name": "skillListing",
            "type": "pubkey"
          },
          {
            "name": "purchase",
            "type": "pubkey"
          },
          {
            "name": "listingRevision",
            "type": "u64"
          },
          {
            "name": "listingSettlement",
            "type": "pubkey"
          },
          {
            "name": "amountUsdcMicros",
            "type": "u64"
          },
          {
            "name": "authorShareUsdcMicros",
            "type": "u64"
          },
          {
            "name": "voucherPoolUsdcMicros",
            "type": "u64"
          },
          {
            "name": "settledAt",
            "type": "i64"
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "x402SettlementSignatureGuard",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "settlementTxSignatureHash",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "receipt",
            "type": "pubkey"
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    }
  ]
};
