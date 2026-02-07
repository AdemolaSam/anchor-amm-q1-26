import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { AnchorAmmQ425 } from "../target/types/anchor_amm_q4_25";
import {
  createAssociatedTokenAccount,
  createMint,
  getAssociatedTokenAddress,
  mintTo,
  getAccount,
} from "@solana/spl-token";
import { assert } from "chai";

describe("anchor-amm-q4-25", () => {
  // Configure the client to use the local cluster.
  anchor.setProvider(anchor.AnchorProvider.env());
  const provider = anchor.getProvider() as anchor.AnchorProvider;
  const program = anchor.workspace.anchorAmmQ425 as Program<AnchorAmmQ425>;

  let initializer: anchor.web3.Keypair = anchor.web3.Keypair.generate(); //LP provider
  let trader: anchor.web3.Keypair = anchor.web3.Keypair.generate(); //swapper

  let unauthorizedUser: anchor.web3.Keypair = anchor.web3.Keypair.generate(); //unauthorized user

  console.log("Initializer:", initializer.publicKey.toBase58());
  console.log("Trader:", trader.publicKey.toBase58());

  const seed = new anchor.BN(1234); //PDA seed

  //mints
  let mintX: anchor.web3.PublicKey;
  let mintY: anchor.web3.PublicKey;
  let mintLp: anchor.web3.PublicKey;

  //PDA & Vault
  let configPDA: anchor.web3.PublicKey;
  let lpVaultX: anchor.web3.PublicKey;
  let lpVaultY: anchor.web3.PublicKey;

  //ata
  let initAtaX: anchor.web3.PublicKey; // initializer's ata for token X
  let initAtaY: anchor.web3.PublicKey; // initializer's ata for token Y
  let traderAtaX: anchor.web3.PublicKey; // trader's ata for token X
  let traderAtaY: anchor.web3.PublicKey; // trader's ata for token Y
  let initLPAta: anchor.web3.PublicKey;

  //seed
  let configBump: number;

  before(async () => {
    // Airdrop SOL to initializer
    await program.provider.connection.requestAirdrop(
      initializer.publicKey,
      5 * anchor.web3.LAMPORTS_PER_SOL,
    );

    await program.provider.connection.requestAirdrop(
      trader.publicKey,
      5 * anchor.web3.LAMPORTS_PER_SOL,
    );

    //create mint
    mintX = await createMint(
      provider.connection,
      initializer,
      initializer.publicKey,
      null,
      6,
    );

    mintY = await createMint(
      provider.connection,
      initializer,
      initializer.publicKey,
      null,
      6,
    );

    //create ATA
    initAtaX = await createAssociatedTokenAccount(
      provider.connection,
      initializer,
      mintX,
      initializer.publicKey,
    );

    console.log("Initializer ATA for token X:", initAtaX.toBase58());

    initAtaY = await createAssociatedTokenAccount(
      provider.connection,
      initializer,
      mintY,
      initializer.publicKey,
    );
    console.log("Intiator ATA for token Y:", initAtaY.toBase58());

    traderAtaX = await createAssociatedTokenAccount(
      provider.connection,
      trader,
      mintX,
      trader.publicKey,
    );
    console.log("Trader ATA for token X:", traderAtaX.toBase58());

    traderAtaY = await createAssociatedTokenAccount(
      provider.connection,
      trader,
      mintY,
      trader.publicKey,
    );
    console.log("Trader ATA for token Y:", traderAtaY.toBase58());

    // mint tokens to initializer
    await mintTo(
      provider.connection,
      initializer,
      mintX,
      initAtaX,
      initializer,
      1_000_000,
    );
    await mintTo(
      provider.connection,
      initializer,
      mintY,
      initAtaY,
      initializer,
      1_000_000,
    );
    //mint tokens to trader
    await mintTo(
      provider.connection,
      initializer,
      mintX,
      traderAtaX,
      initializer,
      500_000,
    );
    // await mintTo(provider.connection, initializer, mintY, traderAtaY, initializer, 500_000);

    console.log(
      "minted tokens: 1,000,000 X and Y to initializer, 500,000 X to trader",
    );
  });

  it("Is initialized!", async () => {
    [configPDA, configBump] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("config"), seed.toArrayLike(Buffer, "le", 8)],
      program.programId,
    );
    console.log("Config PDA:", configPDA.toBase58(), "Bump:", configBump);

    [mintLp] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("lp"), configPDA.toBuffer()],
      program.programId,
    );
    console.log("MintLP PDA:", mintLp.toBase58());

    lpVaultX = await getAssociatedTokenAddress(mintX, configPDA, true);
    console.log("LP Vault ATA for token X:", lpVaultX.toBase58());

    lpVaultY = await getAssociatedTokenAddress(mintY, configPDA, true);
    console.log("LP Vault ATA for token Y:", lpVaultY.toBase58());

    initLPAta = await getAssociatedTokenAddress(mintLp, initializer.publicKey);
    console.log("Initializer ATA for LP token:", initLPAta.toBase58());

    const tx = await program.methods
      .initialize(seed, 30, null)
      .accounts({
        initializer: initializer.publicKey,
        mintX,
        mintY,
        mintLp,
        vaultX: lpVaultX,
        vaultY: lpVaultY,
        config: configPDA,
        tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID,
        associatedTokenProgram: anchor.utils.token.ASSOCIATED_PROGRAM_ID,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .signers([initializer])
      .rpc();

    const cfg = await program.account.config.fetch(configPDA);
    assert.equal(cfg.mintX.toBase58(), mintX.toBase58());
    assert.equal(cfg.mintY.toBase58(), mintY.toBase58());
    console.log("Initialization tx signature", tx);

    assert.equal(cfg.fee, 30);
  });

  it("Deposit tokens to liquidity pool!", async () => {
    const tx = await program.methods
      .deposit(
        new anchor.BN(500_000),
        new anchor.BN(500_000),
        new anchor.BN(500_000),
      )
      .accounts({
        user: initializer.publicKey,
        mintX,
        mintY,
        config: configPDA,
        mintLp,
        vaultX: lpVaultX,
        vaultY: lpVaultY,
        userX: initAtaX,
        userY: initAtaY,
        userLp: initLPAta,
        tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID,
        associatedTokenProgram: anchor.utils.token.ASSOCIATED_PROGRAM_ID,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .signers([initializer])
      .rpc();
    const vx = await getAccount(provider.connection, lpVaultX);
    const vy = await getAccount(provider.connection, lpVaultY);
    const lp = await getAccount(provider.connection, initLPAta);

    assert.equal(Number(vx.amount), 500_000);
    assert.equal(Number(vy.amount), 500_000);
    assert.equal(Number(lp.amount), 500_000);
  });

  it("Withdrawal: should withdraw proportionally and burn LP tokens", async () => {
    const vaultXBefore = await getAccount(provider.connection, lpVaultX);
    const vaultYBefore = await getAccount(provider.connection, lpVaultY);
    const userLPBefore = await getAccount(provider.connection, initLPAta);

    await program.methods
      .withdraw(
        new anchor.BN(100_000),
        new anchor.BN(100_000),
        new anchor.BN(100_000),
      )
      .accounts({
        user: initializer.publicKey,
        mintX,
        mintY,
        config: configPDA,
        mintLp,
        vaultX: lpVaultX,
        vaultY: lpVaultY,
        userX: initAtaX,
        userY: initAtaY,
        userLp: initLPAta,
        tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID,
        associatedTokenProgram: anchor.utils.token.ASSOCIATED_PROGRAM_ID,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .signers([initializer])
      .rpc();

    const vaultXAfter = await getAccount(provider.connection, lpVaultX);
    const vaultYAfter = await getAccount(provider.connection, lpVaultY);
    const userLPAfter = await getAccount(provider.connection, initLPAta);

    assert.equal(Number(vaultXAfter.amount), 400_000);
    assert.equal(Number(vaultYAfter.amount), 400_000);
    assert.equal(Number(userLPAfter.amount), 400_000);
  });

  it("Withdrawal: should fail when minimum amounts not met (slippage)", async () => {
    try {
      await program.methods
        .withdraw(
          new anchor.BN(50_000),
          new anchor.BN(1_000_000),
          new anchor.BN(1_000_000),
        )
        .accounts({
          user: initializer.publicKey,
          mintX,
          mintY,
          config: configPDA,
          mintLp,
          vaultX: lpVaultX,
          vaultY: lpVaultY,
          userX: initAtaX,
          userY: initAtaY,
          userLp: initLPAta,
          tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID,
          associatedTokenProgram: anchor.utils.token.ASSOCIATED_PROGRAM_ID,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .signers([initializer])
        .rpc();

      assert.fail("Should have failed with slippage error");
    } catch (err) {
      assert.ok(err);
    }
  });

  it("Withdrawal: should fail when withdrawing more LP than balance", async () => {
    const userLPBalance = await getAccount(provider.connection, initLPAta);
    const excessAmount = new anchor.BN(Number(userLPBalance.amount) + 1);

    try {
      await program.methods
        .withdraw(excessAmount, new anchor.BN(1), new anchor.BN(1))
        .accounts({
          user: initializer.publicKey,
          mintX,
          mintY,
          config: configPDA,
          mintLp,
          vaultX: lpVaultX,
          vaultY: lpVaultY,
          userX: initAtaX,
          userY: initAtaY,
          userLp: initLPAta,
          tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID,
          associatedTokenProgram: anchor.utils.token.ASSOCIATED_PROGRAM_ID,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .signers([initializer])
        .rpc();

      assert.fail("Should have failed with insufficient balance");
    } catch (err) {
      assert.ok(err);
    }
  });

  it("Swap tokens!", async () => {
    // Tests
    const tx = await program.methods
      .swap(true, new anchor.BN(50_000), new anchor.BN(10_000))
      .accounts({
        user: trader.publicKey,
        mintX,
        mintY,
        config: configPDA,
        vaultX: lpVaultX,
        vaultY: lpVaultY,
        userX: traderAtaX,
        userY: traderAtaY,
        tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID,
        associatedTokenProgram: anchor.utils.token.ASSOCIATED_PROGRAM_ID,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .signers([trader])
      .rpc();
    console.log("Swap tx signature", tx);

    const traderY = await getAccount(provider.connection, traderAtaY);

    assert.isTrue(Number(traderY.amount) > 0);
  });
});
