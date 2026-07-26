Here is the idea, ENS hacking :)

Using ENS wildcards we can do some interesting things.
We can essentially use the wildcards to call a pure view function on the smartcontract and then return some text fields.
Combining this with the fallback behavior of eth.xyz, we should be able to create a dynamic "scorecard" of a solved maze seed.

so mazeking.eth should point to the deployed mazeking contract
but myseed.mazeking.eth should point to a collection of text records that describe the solved maze. `avatar` should be a pointer to the encoded <svg> from the smart contract rendering -> so data:image/svg+xml;base64,...
`url` -> mazeking.io/s/myseed
`first_place` -> address (or .eth equiv), move count, timestamp (tied move counts get sorted by timestamp)
`second_place` -> ...
`third_place` -> ...


eth.xyz/myseed.mazeking.eth should then render this nicely

```solidity
interface IExtendedResolver {
    function resolve(bytes calldata name, bytes calldata data)
        external view returns (bytes memory);
}

contract WildcardTextResolver is IExtendedResolver {
    IMyBackend public immutable backend;

    constructor(IMyBackend _backend) { backend = _backend; }

    function resolve(bytes calldata name, bytes calldata data)
        external view returns (bytes memory)
    {
        require(bytes4(data[:4]) == ITextResolver.text.selector, "unsupported");
        (, string memory key) = abi.decode(data[4:], (bytes32, string));

        // DNS wire format: <len><label><len><label>...\x00
        uint8 len = uint8(name[0]);
        string memory label = string(name[1:1 + len]);

        return abi.encode(backend.lookup(label, key)); // your function's string
    }

    function supportsInterface(bytes4 id) external pure returns (bool) {
        return id == type(IExtendedResolver).interfaceId || id == 0x01ffc9a7;
    }
}
```

Plan:
deploy mazeking onto polygon zkEVM
point mazeking.eth to this deployed contract using a chainId
setup this wildcard resolver (directly on mazeking or as separate contract)
store top scorers of mazes efficiently
test to make sure this is working appropriately


