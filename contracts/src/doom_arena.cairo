use starknet::ContractAddress;

#[derive(Drop, Serde, Copy, PartialEq, starknet::Store)]
pub enum MatchState {
    #[default]
    None,
    Open,
    Locked,
    Settled,
}

#[starknet::interface]
pub trait IDoomArena<TContractState> {
    // Admin
    fn set_operator(ref self: TContractState, operator: ContractAddress);
    fn get_operator(self: @TContractState) -> ContractAddress;

    // Match lifecycle
    fn create_match(ref self: TContractState, match_id: felt252);
    fn deposit(ref self: TContractState, match_id: felt252);
    fn lock_match(ref self: TContractState, match_id: felt252);
    fn record_kill(ref self: TContractState, match_id: felt252, killer: ContractAddress);
    fn settle_match(ref self: TContractState, match_id: felt252);
    fn withdraw(ref self: TContractState, match_id: felt252);
    fn emergency_refund(ref self: TContractState, match_id: felt252);

    // Views
    fn get_match_state(self: @TContractState, match_id: felt252) -> MatchState;
    fn get_balance(self: @TContractState, match_id: felt252, player: ContractAddress) -> u256;
    fn get_players(
        self: @TContractState, match_id: felt252,
    ) -> (ContractAddress, ContractAddress);
    fn get_player_count(self: @TContractState, match_id: felt252) -> u8;
}

#[starknet::contract]
mod DoomArena {
    use starknet::{ContractAddress, get_caller_address, get_contract_address, get_block_timestamp};
    use starknet::storage::{Map, StorageMapReadAccess, StorageMapWriteAccess, StoragePointerReadAccess, StoragePointerWriteAccess};
    use openzeppelin_token::erc20::interface::{IERC20Dispatcher, IERC20DispatcherTrait};
    use super::{IDoomArena, MatchState};

    // Starknet mainnet USDC
    const USDC_ADDRESS: felt252 =
        0x053c91253bc9682c04929ca02ed00b3e423f6710d2ee7e0d5ebb06f3ecf368a8;
    const ENTRY_FEE: u256 = 1_000_000; // 1 USDC (6 decimals)
    const BOUNTY: u256 = 100_000; // 0.10 USDC
    const REFUND_TIMEOUT: u64 = 3600; // 1 hour in seconds

    #[storage]
    struct Storage {
        owner: ContractAddress,
        operator: ContractAddress,
        // Match data stored in maps keyed by match_id
        match_state: Map<felt252, MatchState>,
        match_player_a: Map<felt252, ContractAddress>,
        match_player_b: Map<felt252, ContractAddress>,
        match_balance_a: Map<felt252, u256>,
        match_balance_b: Map<felt252, u256>,
        match_player_count: Map<felt252, u8>,
        match_created_at: Map<felt252, u64>,
        match_withdrawn_a: Map<felt252, bool>,
        match_withdrawn_b: Map<felt252, bool>,
    }

    #[event]
    #[derive(Drop, starknet::Event)]
    enum Event {
        MatchCreated: MatchCreated,
        PlayerDeposited: PlayerDeposited,
        MatchLocked: MatchLocked,
        KillRecorded: KillRecorded,
        MatchSettled: MatchSettled,
        Withdrawal: Withdrawal,
        Refund: Refund,
    }

    #[derive(Drop, starknet::Event)]
    struct MatchCreated {
        #[key]
        match_id: felt252,
    }

    #[derive(Drop, starknet::Event)]
    struct PlayerDeposited {
        #[key]
        match_id: felt252,
        player: ContractAddress,
    }

    #[derive(Drop, starknet::Event)]
    struct MatchLocked {
        #[key]
        match_id: felt252,
    }

    #[derive(Drop, starknet::Event)]
    struct KillRecorded {
        #[key]
        match_id: felt252,
        killer: ContractAddress,
        victim: ContractAddress,
        killer_balance: u256,
        victim_balance: u256,
    }

    #[derive(Drop, starknet::Event)]
    struct MatchSettled {
        #[key]
        match_id: felt252,
    }

    #[derive(Drop, starknet::Event)]
    struct Withdrawal {
        #[key]
        match_id: felt252,
        player: ContractAddress,
        amount: u256,
    }

    #[derive(Drop, starknet::Event)]
    struct Refund {
        #[key]
        match_id: felt252,
        player: ContractAddress,
        amount: u256,
    }

    #[constructor]
    fn constructor(ref self: ContractState, owner: ContractAddress, operator: ContractAddress) {
        self.owner.write(owner);
        self.operator.write(operator);
    }

    fn get_usdc() -> IERC20Dispatcher {
        IERC20Dispatcher {
            contract_address: USDC_ADDRESS.try_into().unwrap(),
        }
    }

    #[abi(embed_v0)]
    impl DoomArenaImpl of IDoomArena<ContractState> {
        fn set_operator(ref self: ContractState, operator: ContractAddress) {
            assert(get_caller_address() == self.owner.read(), 'Only owner');
            self.operator.write(operator);
        }

        fn get_operator(self: @ContractState) -> ContractAddress {
            self.operator.read()
        }

        fn create_match(ref self: ContractState, match_id: felt252) {
            let caller = get_caller_address();
            assert(
                caller == self.operator.read() || caller == self.owner.read(),
                'Only operator/owner',
            );
            assert(self.match_state.read(match_id) == MatchState::None, 'Match already exists');

            self.match_state.write(match_id, MatchState::Open);
            self.match_player_count.write(match_id, 0);
            self.match_created_at.write(match_id, get_block_timestamp());

            self.emit(MatchCreated { match_id });
        }

        fn deposit(ref self: ContractState, match_id: felt252) {
            assert(self.match_state.read(match_id) == MatchState::Open, 'Match not open');

            let caller = get_caller_address();
            let count = self.match_player_count.read(match_id);
            assert(count < 2, 'Match full');

            // Ensure player hasn't already deposited
            if count == 1 {
                assert(self.match_player_a.read(match_id) != caller, 'Already deposited');
            }

            // Transfer USDC from player to this contract
            let success = get_usdc()
                .transfer_from(caller, get_contract_address(), ENTRY_FEE);
            assert(success, 'USDC transfer failed');

            // Register player
            if count == 0 {
                self.match_player_a.write(match_id, caller);
                self.match_balance_a.write(match_id, ENTRY_FEE);
            } else {
                self.match_player_b.write(match_id, caller);
                self.match_balance_b.write(match_id, ENTRY_FEE);
            }
            self.match_player_count.write(match_id, count + 1);

            self.emit(PlayerDeposited { match_id, player: caller });
        }

        fn lock_match(ref self: ContractState, match_id: felt252) {
            assert(
                get_caller_address() == self.operator.read(),
                'Only operator',
            );
            assert(self.match_state.read(match_id) == MatchState::Open, 'Match not open');
            assert(self.match_player_count.read(match_id) == 2, 'Need 2 players');

            self.match_state.write(match_id, MatchState::Locked);
            self.emit(MatchLocked { match_id });
        }

        fn record_kill(ref self: ContractState, match_id: felt252, killer: ContractAddress) {
            assert(
                get_caller_address() == self.operator.read(),
                'Only operator',
            );
            assert(self.match_state.read(match_id) == MatchState::Locked, 'Match not locked');

            let player_a = self.match_player_a.read(match_id);
            let player_b = self.match_player_b.read(match_id);

            let (victim, mut killer_bal, mut victim_bal) = if killer == player_a {
                (
                    player_b,
                    self.match_balance_a.read(match_id),
                    self.match_balance_b.read(match_id),
                )
            } else {
                assert(killer == player_b, 'Killer not in match');
                (
                    player_a,
                    self.match_balance_b.read(match_id),
                    self.match_balance_a.read(match_id),
                )
            };

            // Transfer bounty: min(BOUNTY, victim_balance)
            let transfer = if victim_bal < BOUNTY {
                victim_bal
            } else {
                BOUNTY
            };
            killer_bal += transfer;
            victim_bal -= transfer;

            // Write updated balances
            if killer == player_a {
                self.match_balance_a.write(match_id, killer_bal);
                self.match_balance_b.write(match_id, victim_bal);
            } else {
                self.match_balance_b.write(match_id, killer_bal);
                self.match_balance_a.write(match_id, victim_bal);
            }

            // Auto-settle if victim is bankrupt
            if victim_bal == 0 {
                self.match_state.write(match_id, MatchState::Settled);
                self.emit(MatchSettled { match_id });
            }

            self
                .emit(
                    KillRecorded {
                        match_id,
                        killer,
                        victim,
                        killer_balance: killer_bal,
                        victim_balance: victim_bal,
                    },
                );
        }

        fn settle_match(ref self: ContractState, match_id: felt252) {
            let caller = get_caller_address();
            assert(
                caller == self.operator.read() || caller == self.owner.read(),
                'Only operator/owner',
            );
            assert(self.match_state.read(match_id) == MatchState::Locked, 'Match not locked');

            self.match_state.write(match_id, MatchState::Settled);
            self.emit(MatchSettled { match_id });
        }

        fn withdraw(ref self: ContractState, match_id: felt252) {
            assert(self.match_state.read(match_id) == MatchState::Settled, 'Match not settled');

            let caller = get_caller_address();
            let player_a = self.match_player_a.read(match_id);
            let player_b = self.match_player_b.read(match_id);

            let (amount, is_a) = if caller == player_a {
                assert(!self.match_withdrawn_a.read(match_id), 'Already withdrawn');
                (self.match_balance_a.read(match_id), true)
            } else if caller == player_b {
                assert(!self.match_withdrawn_b.read(match_id), 'Already withdrawn');
                (self.match_balance_b.read(match_id), false)
            } else {
                panic!("Not a player in this match")
            };

            if amount > 0 {
                let success = get_usdc().transfer(caller, amount);
                assert(success, 'USDC transfer failed');
            }

            if is_a {
                self.match_withdrawn_a.write(match_id, true);
            } else {
                self.match_withdrawn_b.write(match_id, true);
            }

            self.emit(Withdrawal { match_id, player: caller, amount });
        }

        fn emergency_refund(ref self: ContractState, match_id: felt252) {
            let state = self.match_state.read(match_id);
            assert(
                state == MatchState::Open || state == MatchState::Locked,
                'Cannot refund',
            );

            // Check timeout
            let created_at = self.match_created_at.read(match_id);
            let now = get_block_timestamp();
            assert(now >= created_at + REFUND_TIMEOUT, 'Too early for refund');

            let caller = get_caller_address();
            let player_a = self.match_player_a.read(match_id);
            let player_b = self.match_player_b.read(match_id);

            // Refund original deposits (not current balances, to be fair)
            if caller == player_a && !self.match_withdrawn_a.read(match_id) {
                let success = get_usdc().transfer(caller, ENTRY_FEE);
                assert(success, 'USDC transfer failed');
                self.match_withdrawn_a.write(match_id, true);
                self.emit(Refund { match_id, player: caller, amount: ENTRY_FEE });
            } else if caller == player_b && !self.match_withdrawn_b.read(match_id) {
                let success = get_usdc().transfer(caller, ENTRY_FEE);
                assert(success, 'USDC transfer failed');
                self.match_withdrawn_b.write(match_id, true);
                self.emit(Refund { match_id, player: caller, amount: ENTRY_FEE });
            } else {
                panic!("Not a player or already refunded");
            }

            // Mark match as settled if both refunded
            if self.match_withdrawn_a.read(match_id) && self.match_withdrawn_b.read(match_id) {
                self.match_state.write(match_id, MatchState::Settled);
            }
        }

        fn get_match_state(self: @ContractState, match_id: felt252) -> MatchState {
            self.match_state.read(match_id)
        }

        fn get_balance(
            self: @ContractState, match_id: felt252, player: ContractAddress,
        ) -> u256 {
            let player_a = self.match_player_a.read(match_id);
            if player == player_a {
                self.match_balance_a.read(match_id)
            } else {
                self.match_balance_b.read(match_id)
            }
        }

        fn get_players(
            self: @ContractState, match_id: felt252,
        ) -> (ContractAddress, ContractAddress) {
            (
                self.match_player_a.read(match_id),
                self.match_player_b.read(match_id),
            )
        }

        fn get_player_count(self: @ContractState, match_id: felt252) -> u8 {
            self.match_player_count.read(match_id)
        }
    }
}
