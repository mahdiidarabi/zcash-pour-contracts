pragma circom 2.1.0;

// ---------------------------------------------------------------------------
// Hash list check circuit
// ---------------------------------------------------------------------------
// Proves: "I know a secret r and an index j such that Poseidon(r) equals
// the j-th element of a public list of n hashes" — without revealing r or j.
//
// Public:  hashes[n] (the list), ok (1 if the check passes).
// Private: r (preimage), j (index in 0..n-1).
// ---------------------------------------------------------------------------

include "../node_modules/circomlib/circuits/poseidon.circom";
include "../node_modules/circomlib/circuits/comparators.circom";
include "../node_modules/circomlib/circuits/multiplexer.circom";
include "../node_modules/circomlib/circuits/bitify.circom";



template spending_sn_circuit(n) {
    // --- Private inputs (witness only; not exposed in main) ---
    
    signal input v;   // value of cm
    signal input j;   // Index in [0..n-1]: position of that hash in the list
    signal input r_old;   // secret random seed that create the cm, cm = hash(r_old || sn_produce || v)
    signal input rho; // random number to increase entropy of sn_produce, sn_produce = hash(rho||hash(sk_old)), pk_old = hash(sk_old)
    signal input sk_old; // secret key identifier that we can create the sn_consume with it and it defines ownership, sn_consume = hash(sn_produce||sk_old)

    // --- Public list (wired from main; part of the public statement) ---
    signal input cm_list[n];
    signal input sn_consume;

    // --- Output: 1 if Poseidon(r) == hashes[j], else constraint fails ---
    signal output ok;

    // --- Step 1: Compute Poseidon(r) ---
    // Same hash as circomlib/circomlibjs; use get_hash.js to compute hashes for input.json
    component h1 = Poseidon(1);
    h1.inputs[0] <== sk_old;
    signal pk_old;
    pk_old <== h1.out;

    component h2 = Poseidon(2);
    h2.inputs[0] <== rho;
    h2.inputs[1] <== pk_old;
    signal sn_produce;
    sn_produce <== h2.out;

    component h3 = Poseidon(2);
    h3.inputs[0] <== sn_produce;
    h3.inputs[1] <== sk_old;
    signal sn_consume_calculated;
    sn_consume_calculated <== h3.out;

    sn_consume_calculated === sn_consume;


    component h4 = Poseidon(3);
    h4.inputs[0] <== r_old;
    h4.inputs[1] <== sn_produce;
    h4.inputs[2] <== v;
    signal cm_j_calculated;
    cm_j_calculated <== h4.out;

    //signal cm_list_j_selected;
    //cm_list_j_selected <== 0;

    // Create a signal to hold the selected valu
    // Initialize to 0
    
    signal acc[n+1];
    acc[0] <== 0;

    component isEq[n];

    for (var i = 0; i < n; i++) {
        isEq[i] = IsEqual();
        isEq[i].in[0] <== j;
        isEq[i].in[1] <== i;

        acc[i+1] <== acc[i] + isEq[i].out * cm_list[i];
    }

    signal cm_list_j_selected;
    cm_list_j_selected <== acc[n];

    cm_list_j_selected === cm_j_calculated;


    // ── range check j ─────────────────────────────────
    component rangeJ = LessThan(10); // assuming n ≤ 16
    rangeJ.in[0] <== j;
    rangeJ.in[1] <== n;
    rangeJ.out === 1;

    ok <== 1;
}

template pour_circuit(){
    signal input v;

    // for pour circuit, we split money in two address (r1, rho1, v1, pk1) and (r2, rho2, v2, pk2) and all of them are private
    signal input r1;
    signal input rho1;
    signal input v1;
    signal input pk1;

    signal input r2;
    signal input rho2;
    signal input v2;
    signal input pk2;

    v === v1+v2;

    // claim 2 check 0 <= v1 < 2^32 and  0 <= v2 < 2^32 with Num2Bits
    component range1 = Num2Bits(32);
    range1.in <== v1;

    component range2 = Num2Bits(32);
    range2.in <== v2;

    // now let's calculate cm1 and cm2

    component h1 = Poseidon(2);
    h1.inputs[0] <== rho1;
    h1.inputs[1] <== pk1;
    signal sn_produce_1;
    sn_produce_1 <== h1.out;

    component h11 = Poseidon(3);
    h11.inputs[0] <== r1;
    h11.inputs[1] <== sn_produce_1;
    h11.inputs[2] <== v1;
    signal output cm1 <== h11.out;

    component h2 = Poseidon(2);
    h2.inputs[0] <== rho2;
    h2.inputs[1] <== pk2;
    signal sn_produce_2;
    sn_produce_2 <== h2.out;

    component h21 = Poseidon(3);
    h21.inputs[0] <== r2;
    h21.inputs[1] <== sn_produce_2;
    h21.inputs[2] <== v2;
    signal output cm2 <== h21.out;

}

template Main(n) {

    // for pour circuit, we split money in two address (r1, rho1, v1, pk1) and (r2, rho2, v2, pk2) and all of them are private
    signal input r1;
    signal input rho1;
    signal input v1;
    signal input pk1;

    signal input r2;
    signal input rho2;
    signal input v2;
    signal input pk2;

    signal output cm1;
    signal output cm2;

    // --- Private inputs (witness only; not exposed in main) --- for spending circuit
    signal input v;   // value of cm
    signal input j;   // Index in [0..n-1]: position of that hash in the list
    signal input r_old;   // secret random seed that create the cm, cm = hash(r_old || sn_produce || v)
    signal input rho; // random number to increase entropy of sn_produce, sn_produce = hash(rho||hash(sk_old)), pk_old = hash(sk_old)
    signal input sk_old; // secret key identifier that we can create the sn_consume with it and it defines ownership, sn_consume = hash(sn_produce||sk_old)

    // --- Public list (wired from main; part of the public statement) ---
    signal input cm_list[n];
    signal input sn_consume;

    // --- Output: 1 if Poseidon(r) == hashes[j], else constraint fails ---
    signal output ok;

    component c = spending_sn_circuit(n);

    component p = pour_circuit();

    p.v <==v;
    p.r1 <== r1;
    p.rho1 <== rho1;
    p.v1 <== v1;
    p.pk1 <== pk1;

    p.r2 <== r2;
    p.rho2 <== rho2;
    p.v2 <== v2;
    p.pk2 <== pk2;


    // get output for the pour circuit
    cm1 <== p.cm1;
    cm2 <== p.cm2;


    c.v <== v;
    c.j <== j;
    c.r_old <== r_old;
    c.rho <== rho;
    c.sk_old <== sk_old;

    for(var i = 0; i < n; i++){
        c.cm_list[i] <== cm_list[i];
    }

    c.sn_consume <== sn_consume;

    ok <== c.ok;

    
}

component main {public [cm_list, sn_consume]} = Main(10);