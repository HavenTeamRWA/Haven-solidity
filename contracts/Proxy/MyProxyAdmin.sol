// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ProxyAdmin} from "@openzeppelin/contracts/proxy/transparent/ProxyAdmin.sol";

contract MyProxyAdmin is ProxyAdmin {
    constructor() ProxyAdmin(msg.sender) {}

    // 如果需要自定义升级逻辑，可以在这里添加
    // 否则直接继承 ProxyAdmin 的默认行为即可
}