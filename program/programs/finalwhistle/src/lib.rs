//! Final Whistle — trustless World Cup prediction markets on Solana.
//!
//! Parimutuel pools escrowed in program PDAs. Settlement is permissionless:
//! anyone may submit a TxLINE Merkle proof for the finalised match record, and
//! the program confirms the outcome by CPI into TxLINE's `validate_stat_v2`
//! before releasing funds. No admin key can decide a result.

use anchor_lang::prelude::*;
use anchor_lang::system_program;

declare_program!(txoracle);
use txoracle::program::Txoracle;
use txoracle::types::{
    BinaryExpression, Comparison, NDimensionalStrategy, StatPredicate, StatValidationInput,
    TraderPredicate,
};

declare_id!("3pqHn5WcqLpHRcZDP6FKTSez7VmjeDDzzuxb72FUoB3P");

/// TxLINE encodes finalised match records with `period = 100`
/// (`action=game_finalised`, covers FT, AET, penalties and abandonment).
pub const FINAL_PERIOD: i32 = 100;

/// TxLINE full-game stat keys (period prefix 0).
pub const STAT_HOME_GOALS: u32 = 1;
pub const STAT_AWAY_GOALS: u32 = 2;
pub const STAT_HOME_CORNERS: u32 = 7;
pub const STAT_AWAY_CORNERS: u32 = 8;

/// If nobody produced a valid settlement proof within this window after
/// kickoff, bettors may void the market and reclaim their stakes.
pub const VOID_AFTER_SECONDS: i64 = 5 * 24 * 60 * 60;

#[program]
pub mod finalwhistle {
    use super::*;

    /// Open a parimutuel market for a fixture. Permissionless — the market
    /// address is deterministic in (fixture, kind, line), so duplicates are
    /// impossible and any UI can derive it.
    pub fn create_market(
        ctx: Context<CreateMarket>,
        fixture_id: i64,
        kind: MarketKind,
        line: i32,
        nonce: u16,
        kickoff_ts: i64,
    ) -> Result<()> {
        require!(fixture_id > 0, FwError::BadFixture);
        require!(kickoff_ts > 0, FwError::BadKickoff);
        if matches!(kind, MarketKind::TotalGoals | MarketKind::TotalCorners) {
            // `line` encodes a half line: line = N means "over/under N.5".
            require!(line >= 0, FwError::BadLine);
        } else {
            require!(line == 0, FwError::BadLine);
        }

        let market = &mut ctx.accounts.market;
        market.fixture_id = fixture_id;
        market.kind = kind;
        market.line = line;
        market.nonce = nonce;
        market.kickoff_ts = kickoff_ts;
        market.state = MarketState::Open;
        market.winning_outcome = 0;
        market.pools = [0; 3];
        market.settled_ts = 0;
        market.creator = ctx.accounts.creator.key();
        market.bump = ctx.bumps.market;
        market.vault_bump = ctx.bumps.vault;
        Ok(())
    }

    /// Stake lamports on an outcome. Betting closes at kickoff.
    pub fn place_bet(ctx: Context<PlaceBet>, outcome: u8, amount: u64) -> Result<()> {
        let market = &mut ctx.accounts.market;
        require!(market.state == MarketState::Open, FwError::MarketNotOpen);
        require!(
            Clock::get()?.unix_timestamp < market.kickoff_ts,
            FwError::BettingClosed
        );
        require!((outcome as usize) < market.kind.outcomes(), FwError::BadOutcome);
        require!(amount > 0, FwError::BadAmount);

        system_program::transfer(
            CpiContext::new(
                ctx.accounts.system_program.to_account_info(),
                system_program::Transfer {
                    from: ctx.accounts.bettor.to_account_info(),
                    to: ctx.accounts.vault.to_account_info(),
                },
            ),
            amount,
        )?;

        market.pools[outcome as usize] = market.pools[outcome as usize]
            .checked_add(amount)
            .ok_or(FwError::MathOverflow)?;

        let position = &mut ctx.accounts.position;
        if position.amount == 0 {
            position.market = market.key();
            position.bettor = ctx.accounts.bettor.key();
            position.outcome = outcome;
            position.bump = ctx.bumps.position;
        } else {
            require!(position.outcome == outcome, FwError::BadOutcome);
        }
        position.amount = position
            .amount
            .checked_add(amount)
            .ok_or(FwError::MathOverflow)?;
        Ok(())
    }

    /// Settle the market with a TxLINE Merkle proof of the finalised record.
    ///
    /// Permissionless and deterministic: the caller claims an outcome, the
    /// program derives the exact predicate that outcome implies and asks the
    /// TxLINE oracle program (CPI `validate_stat_v2`) to check the proof
    /// against the Merkle root anchored on-chain for that day. A forged
    /// payload fails root verification; a wrong outcome fails the predicate.
    pub fn settle(
        ctx: Context<Settle>,
        winning_outcome: u8,
        payload: StatValidationInput,
    ) -> Result<()> {
        let market = &ctx.accounts.market;
        require!(market.state == MarketState::Open, FwError::MarketNotOpen);
        require!(
            (winning_outcome as usize) < market.kind.outcomes(),
            FwError::BadOutcome
        );

        // -- Check gate 1: the proof is about our fixture.
        require!(
            payload.fixture_summary.fixture_id == market.fixture_id,
            FwError::WrongFixture
        );

        // -- Check gate 2: the proof covers exactly the stats this market
        //    settles on, taken from the finalised (period 100) record.
        let expected_keys: [u32; 2] = match market.kind {
            MarketKind::Winner | MarketKind::TotalGoals => [STAT_HOME_GOALS, STAT_AWAY_GOALS],
            MarketKind::TotalCorners => [STAT_HOME_CORNERS, STAT_AWAY_CORNERS],
        };
        require!(payload.stats.len() == 2, FwError::BadProofShape);
        for (i, leaf) in payload.stats.iter().enumerate() {
            require!(leaf.stat.key == expected_keys[i], FwError::BadProofShape);
            require!(leaf.stat.period == FINAL_PERIOD, FwError::NotFinalised);
        }

        // -- Check gate 3: the daily Merkle-roots account is the canonical
        //    TxLINE PDA for the day of this proof (no attacker-chosen roots).
        let epoch_day = u16::try_from(payload.ts / 86_400_000).map_err(|_| FwError::BadProofShape)?;
        let (expected_roots, _) = Pubkey::find_program_address(
            &[b"daily_scores_roots", &epoch_day.to_le_bytes()],
            &txoracle::ID,
        );
        require_keys_eq!(
            ctx.accounts.daily_scores_merkle_roots.key(),
            expected_roots,
            FwError::WrongRootsAccount
        );

        // -- Build the predicate implied by the claimed outcome.
        let strategy = build_strategy(market.kind, market.line, winning_outcome)?;

        // -- Ask the TxLINE oracle to verify proof + predicate on-chain.
        let ret = txoracle::cpi::validate_stat_v2(
            CpiContext::new(
                ctx.accounts.txoracle_program.to_account_info(),
                txoracle::cpi::accounts::ValidateStatV2 {
                    daily_scores_merkle_roots: ctx
                        .accounts
                        .daily_scores_merkle_roots
                        .to_account_info(),
                },
            ),
            payload,
            strategy,
        )?;
        require!(ret.get(), FwError::ProofRejected);

        let market = &mut ctx.accounts.market;
        // If the winning pool is empty there is nobody to pay: void instead,
        // so losing bettors can reclaim their stakes.
        if market.pools[winning_outcome as usize] == 0 {
            market.state = MarketState::Void;
        } else {
            market.state = MarketState::Settled;
            market.winning_outcome = winning_outcome;
        }
        market.settled_ts = Clock::get()?.unix_timestamp;
        emit!(MarketSettled {
            market: market.key(),
            fixture_id: market.fixture_id,
            winning_outcome,
            state: market.state,
        });
        Ok(())
    }

    /// Safety hatch: if no valid proof settled the market within
    /// `VOID_AFTER_SECONDS` of kickoff, anyone may void it so stakes can be
    /// reclaimed. Covers cancelled fixtures and keeper outages.
    pub fn void_expired(ctx: Context<VoidExpired>) -> Result<()> {
        let market = &mut ctx.accounts.market;
        require!(market.state == MarketState::Open, FwError::MarketNotOpen);
        require!(
            Clock::get()?.unix_timestamp > market.kickoff_ts + VOID_AFTER_SECONDS,
            FwError::TooEarlyToVoid
        );
        market.state = MarketState::Void;
        market.settled_ts = Clock::get()?.unix_timestamp;
        Ok(())
    }

    /// Withdraw winnings (settled market) or refund (void market).
    /// Payout = stake * total_pool / winning_pool, floor division, so the
    /// vault can never be overdrawn. The position account is closed and its
    /// rent returned to the bettor.
    pub fn claim(ctx: Context<Claim>) -> Result<()> {
        let market = &ctx.accounts.market;
        let position = &ctx.accounts.position;

        let payout = match market.state {
            MarketState::Settled => {
                require!(
                    position.outcome == market.winning_outcome,
                    FwError::NotAWinner
                );
                let total: u128 = market.pools.iter().map(|p| *p as u128).sum();
                let winning_pool = market.pools[market.winning_outcome as usize] as u128;
                u64::try_from((position.amount as u128) * total / winning_pool)
                    .map_err(|_| FwError::MathOverflow)?
            }
            MarketState::Void => position.amount,
            MarketState::Open => return err!(FwError::MarketNotSettled),
        };

        let market_key = market.key();
        let seeds: &[&[u8]] = &[b"vault", market_key.as_ref(), &[market.vault_bump]];
        system_program::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.system_program.to_account_info(),
                system_program::Transfer {
                    from: ctx.accounts.vault.to_account_info(),
                    to: ctx.accounts.bettor.to_account_info(),
                },
                &[seeds],
            ),
            payout,
        )?;
        Ok(())
    }
}

/// Translate (market kind, line, claimed outcome) into the TxLINE predicate
/// that must hold over the finalised stats. Pure function — the settlement
/// logic is fully deterministic and auditable.
fn build_strategy(
    kind: MarketKind,
    line: i32,
    outcome: u8,
) -> Result<NDimensionalStrategy> {
    // stats[0] = home stat, stats[1] = away stat (enforced in `settle`).
    let predicate = match kind {
        MarketKind::Winner => {
            // home - away  >0 home | =0 draw | <0 away
            let comparison = match outcome {
                0 => Comparison::GreaterThan,
                1 => Comparison::EqualTo,
                2 => Comparison::LessThan,
                _ => return err!(FwError::BadOutcome),
            };
            StatPredicate::Binary {
                index_a: 0,
                index_b: 1,
                op: BinaryExpression::Subtract,
                predicate: TraderPredicate {
                    threshold: 0,
                    comparison,
                },
            }
        }
        MarketKind::TotalGoals | MarketKind::TotalCorners => {
            // Half line: over N.5 <=> home+away > N; under N.5 <=> home+away < N+1.
            let (threshold, comparison) = match outcome {
                0 => (line, Comparison::GreaterThan),
                1 => (line.checked_add(1).ok_or(FwError::MathOverflow)?, Comparison::LessThan),
                _ => return err!(FwError::BadOutcome),
            };
            StatPredicate::Binary {
                index_a: 0,
                index_b: 1,
                op: BinaryExpression::Add,
                predicate: TraderPredicate {
                    threshold,
                    comparison,
                },
            }
        }
    };

    Ok(NDimensionalStrategy {
        geometric_targets: vec![],
        distance_predicate: None,
        discrete_predicates: vec![predicate],
    })
}

// ---------------------------------------------------------------------------
// Accounts
// ---------------------------------------------------------------------------

#[account]
#[derive(InitSpace)]
pub struct Market {
    pub fixture_id: i64,
    pub kind: MarketKind,
    /// Half line for totals markets: `line = N` means over/under N.5.
    pub line: i32,
    /// Disambiguator so the same (fixture, kind, line) can be re-opened,
    /// e.g. for replay demos. Production markets use nonce 0.
    pub nonce: u16,
    pub kickoff_ts: i64,
    pub state: MarketState,
    pub winning_outcome: u8,
    /// Lamports staked per outcome. Winner: [home, draw, away]; totals: [over, under, 0].
    pub pools: [u64; 3],
    pub settled_ts: i64,
    pub creator: Pubkey,
    pub bump: u8,
    pub vault_bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct Position {
    pub market: Pubkey,
    pub bettor: Pubkey,
    pub outcome: u8,
    pub amount: u64,
    pub bump: u8,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, InitSpace, Debug)]
pub enum MarketKind {
    /// 1X2: outcomes home / draw / away.
    Winner,
    /// Over/under total goals at a half line.
    TotalGoals,
    /// Over/under total corners at a half line.
    TotalCorners,
}

impl MarketKind {
    pub fn outcomes(&self) -> usize {
        match self {
            MarketKind::Winner => 3,
            MarketKind::TotalGoals | MarketKind::TotalCorners => 2,
        }
    }
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, InitSpace, Debug)]
pub enum MarketState {
    Open,
    Settled,
    Void,
}

#[event]
pub struct MarketSettled {
    pub market: Pubkey,
    pub fixture_id: i64,
    pub winning_outcome: u8,
    pub state: MarketState,
}

#[derive(Accounts)]
#[instruction(fixture_id: i64, kind: MarketKind, line: i32, nonce: u16)]
pub struct CreateMarket<'info> {
    #[account(
        init,
        payer = creator,
        space = 8 + Market::INIT_SPACE,
        seeds = [
            b"market",
            fixture_id.to_le_bytes().as_ref(),
            &[kind as u8],
            line.to_le_bytes().as_ref(),
            nonce.to_le_bytes().as_ref(),
        ],
        bump,
    )]
    pub market: Account<'info, Market>,
    /// Escrow vault: a system account PDA so stakes move by plain
    /// system-program transfers, signed by the program via seeds.
    #[account(
        seeds = [b"vault", market.key().as_ref()],
        bump,
    )]
    pub vault: SystemAccount<'info>,
    #[account(mut)]
    pub creator: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(outcome: u8)]
pub struct PlaceBet<'info> {
    #[account(mut)]
    pub market: Account<'info, Market>,
    #[account(mut, seeds = [b"vault", market.key().as_ref()], bump = market.vault_bump)]
    pub vault: SystemAccount<'info>,
    #[account(
        init_if_needed,
        payer = bettor,
        space = 8 + Position::INIT_SPACE,
        seeds = [b"position", market.key().as_ref(), bettor.key().as_ref(), &[outcome]],
        bump,
    )]
    pub position: Account<'info, Position>,
    #[account(mut)]
    pub bettor: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Settle<'info> {
    #[account(mut)]
    pub market: Account<'info, Market>,
    /// CHECK: address is enforced in the instruction to equal the canonical
    /// TxLINE `daily_scores_roots` PDA for the proof's epoch day; its contents
    /// are read and verified by the TxLINE program during CPI.
    pub daily_scores_merkle_roots: UncheckedAccount<'info>,
    pub txoracle_program: Program<'info, Txoracle>,
}

#[derive(Accounts)]
pub struct VoidExpired<'info> {
    #[account(mut)]
    pub market: Account<'info, Market>,
}

#[derive(Accounts)]
pub struct Claim<'info> {
    #[account(mut)]
    pub market: Account<'info, Market>,
    #[account(mut, seeds = [b"vault", market.key().as_ref()], bump = market.vault_bump)]
    pub vault: SystemAccount<'info>,
    #[account(
        mut,
        close = bettor,
        seeds = [b"position", market.key().as_ref(), bettor.key().as_ref(), &[position.outcome]],
        bump = position.bump,
        has_one = market,
        has_one = bettor,
    )]
    pub position: Account<'info, Position>,
    #[account(mut)]
    pub bettor: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[cfg(test)]
mod tests {
    use super::*;

    fn cmp_of(s: &NDimensionalStrategy) -> (i32, Comparison, BinaryExpression) {
        match &s.discrete_predicates[0] {
            StatPredicate::Binary { op, predicate, .. } => {
                (predicate.threshold, predicate.comparison.clone(), op.clone())
            }
            _ => panic!("expected binary predicate"),
        }
    }

    #[test]
    fn winner_predicates_cover_all_outcomes() {
        // home win: home - away > 0
        let (t, c, op) = cmp_of(&build_strategy(MarketKind::Winner, 0, 0).unwrap());
        assert!(matches!((t, c, op), (0, Comparison::GreaterThan, BinaryExpression::Subtract)));
        // draw: home - away = 0
        let (t, c, _) = cmp_of(&build_strategy(MarketKind::Winner, 0, 1).unwrap());
        assert!(matches!((t, c), (0, Comparison::EqualTo)));
        // away win: home - away < 0
        let (t, c, _) = cmp_of(&build_strategy(MarketKind::Winner, 0, 2).unwrap());
        assert!(matches!((t, c), (0, Comparison::LessThan)));
        assert!(build_strategy(MarketKind::Winner, 0, 3).is_err());
    }

    #[test]
    fn totals_half_line_has_no_push() {
        // Over 2.5 <=> total > 2 ; Under 2.5 <=> total < 3.
        // For any integer total exactly one of the two predicates holds.
        let (t_over, c_over, op) = cmp_of(&build_strategy(MarketKind::TotalGoals, 2, 0).unwrap());
        assert!(matches!((t_over, c_over, op), (2, Comparison::GreaterThan, BinaryExpression::Add)));
        let (t_under, c_under, _) = cmp_of(&build_strategy(MarketKind::TotalGoals, 2, 1).unwrap());
        assert!(matches!((t_under, c_under), (3, Comparison::LessThan)));
        for total in 0..10 {
            let over = total > t_over;
            let under = total < t_under;
            assert!(over ^ under, "push at total={total}");
        }
    }

    #[test]
    fn payout_floor_math_never_overdraws_vault() {
        // Simulate: pools [3 SOL, 1 SOL, 6 SOL], winner outcome 2.
        let pools: [u64; 3] = [3_000_000_000, 1_000_000_000, 6_000_000_000];
        let total: u128 = pools.iter().map(|p| *p as u128).sum();
        let winning = pools[2] as u128;
        // Two winners with uneven stakes.
        let stakes: [u64; 2] = [3_999_999_999, 2_000_000_001];
        let paid: u128 = stakes
            .iter()
            .map(|s| (*s as u128) * total / winning)
            .sum();
        assert!(paid <= total, "vault overdrawn: {paid} > {total}");
    }
}

#[error_code]
pub enum FwError {
    #[msg("Invalid fixture id")]
    BadFixture,
    #[msg("Invalid kickoff timestamp")]
    BadKickoff,
    #[msg("Invalid line for this market kind")]
    BadLine,
    #[msg("Market is not open")]
    MarketNotOpen,
    #[msg("Betting closed at kickoff")]
    BettingClosed,
    #[msg("Outcome index out of range for this market kind")]
    BadOutcome,
    #[msg("Amount must be positive")]
    BadAmount,
    #[msg("Math overflow")]
    MathOverflow,
    #[msg("Proof fixture does not match market fixture")]
    WrongFixture,
    #[msg("Proof stats do not match this market's settlement keys")]
    BadProofShape,
    #[msg("Proof record is not the finalised match record (period 100)")]
    NotFinalised,
    #[msg("Daily scores roots account is not the canonical TxLINE PDA")]
    WrongRootsAccount,
    #[msg("TxLINE oracle rejected the proof or predicate")]
    ProofRejected,
    #[msg("Market not settled yet")]
    MarketNotSettled,
    #[msg("Position did not win this market")]
    NotAWinner,
    #[msg("Void window has not opened yet")]
    TooEarlyToVoid,
}
