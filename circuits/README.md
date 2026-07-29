circom circuits/Multiplier.circom --r1cs --wasm --sym --c -o ./build  

node ./build/Multiplier_js/generate_witness.js ./build/Multiplier_js/Multiplier.wasm ./build/input.json ./build/witness.wtns


snarkjs powersoftau new bn128 12 ptau/pot12_0000.ptau -v 

snarkjs powersoftau contribute ptau/pot12_0000.ptau ptau/pot12_0001.ptau --name="First Contribution" -v

snarkjs powersoftau prepare phase2 ptau/pot12_0001.ptau ptau/pot12_final.ptau -v 

snarkjs groth16 setup ./build/Multiplier.r1cs ./ptau/pot12_final.ptau ./ptau/Multiplier_0000.zkey


snarkjs zkey contribute ./ptau/Multiplier_0000.zkey ./ptau/Multiplier_0001.zkey --name="1st Contributor Name" -v

snarkjs zkey export verificationkey ./ptau/Multiplier_0001.zkey ./ptau/verification_key.json


snarkjs groth16 prove ./ptau/Multiplier_0001.zkey ./build/witness.wtns proof.json public.json


snarkjs groth16 verify ./ptau/verification_key.json public.json proof.json

snarkjs zkey export solidityverifier ./ptau/Multiplier_0001.zkey verifier.sol