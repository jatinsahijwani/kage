// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// Demo-only 18-decimal test asset. Minting is unrestricted on purpose —
/// this contract exists solely so the pool has something to deposit in
/// local/testnet demos and must never be used to represent real value.
contract MockERC20 is ERC20 {
    constructor() ERC20("Kage Test Token", "kUSD") {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}
