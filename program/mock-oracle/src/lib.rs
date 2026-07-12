//! Local-testing mock of TxLINE's txoracle: acknowledges any instruction and
//! sets Borsh return data `true`, letting finalwhistle's settle CPI succeed on
//! a validator where the real oracle (and its Merkle roots) don't exist.
//! NEVER deployed anywhere public — devnet/mainnet use the real program.
use solana_program::{
    account_info::AccountInfo, entrypoint, entrypoint::ProgramResult, program::set_return_data,
    pubkey::Pubkey,
};

entrypoint!(process_instruction);

fn process_instruction(
    _program_id: &Pubkey,
    _accounts: &[AccountInfo],
    _instruction_data: &[u8],
) -> ProgramResult {
    set_return_data(&[1]); // Borsh-encoded `true`
    Ok(())
}
