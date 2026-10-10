<?xml version="1.0" encoding="UTF-8"?>
<model ref="r:6b0d9cf9-4eae-4523-bdaa-7a3ba479b142(qiy.sandbox)">
  <persistence version="9" />
  <languages>
    <use id="6432b3ac-afe1-427b-80cc-e4ec4b2716c5" name="qiy" version="0" />
  </languages>
  <imports />
  <registry>
    <language id="6432b3ac-afe1-427b-80cc-e4ec4b2716c5" name="qiy">
      <concept id="720000000000000001" name="qiy.structure.Application" flags="ng" index="qa">
        <property id="720000000000000101" name="description" index="qb" />
        <property id="720000000000000102" name="basePath" index="qc" />
        <child id="72000000000000101" name="database" index="qd" />
        <child id="72000000000000102" name="entities" index="qe" />
      </concept>
      <concept id="720000000000000002" name="qiy.structure.DatabaseConfig" flags="nn" index="qf">
        <property id="720000000000000201" name="dialect" index="qg" />
        <property id="720000000000000202" name="orm" index="qh" />
        <property id="720000000000000203" name="provider" index="qi" />
        <property id="720000000000000204" name="url" index="qj" />
      </concept>
      <concept id="720000000000000005" name="qiy.structure.Entity" flags="nn" index="qk">
        <property id="720000000000000501" name="tableName" index="ql" />
        <property id="720000000000000502" name="schema" index="qm" />
        <property id="720000000000000503" name="timestamps" index="qn" />
        <child id="72000000000000501" name="fields" index="qo" />
      </concept>
      <concept id="720000000000000006" name="qiy.structure.Field" flags="nn" index="qp">
        <property id="720000000000000601" name="type" index="qq" />
        <property id="720000000000000602" name="columnName" index="qr" />
        <property id="720000000000000603" name="nullable" index="qs" />
        <property id="720000000000000604" name="primaryKey" index="qt" />
        <property id="720000000000000605" name="unique" index="qu" />
        <property id="720000000000000606" name="defaultExpression" index="qv" />
        <property id="720000000000000607" name="generated" index="qw" />
        <property id="720000000000000608" name="extension" index="qx" />
        <property id="720000000000000609" name="softDelete" index="qy" />
        <property id="720000000000000610" name="optimisticLock" index="qz" />
        <property id="720000000000000611" name="dimension" index="ra" />
        <property id="720000000000000612" name="precision" index="rb" />
        <property id="720000000000000613" name="scale" index="rc" />
        <property id="720000000000000614" name="visible" index="qvisible" />
        <property id="720000000000000615" name="listVisible" index="qlistVisible" />
        <property id="720000000000000616" name="formVisible" index="qformVisible" />
        <property id="720000000000000617" name="showVisible" index="qshowVisible" />
        <property id="720000000000000618" name="sortable" index="qsortable" />
        <property id="720000000000000619" name="filterable" index="qfilterable" />
        <property id="720000000000000620" name="label" index="qfieldLabel" />
        <property id="720000000000000621" name="icon" index="qfieldIcon" />
      </concept>
    </language>
    <language id="ceab5195-25ea-4f22-9b92-103b95ca8c0c" name="jetbrains.mps.lang.core">
      <concept id="1169194658468" name="jetbrains.mps.lang.core.structure.INamedConcept" flags="ngI" index="TrEIO">
        <property id="1169194664001" name="name" index="TrG5h" />
      </concept>
    </language>
  </registry>
  <node concept="qa" id="demoApplication">
    <property role="TrG5h" value="QiyDemo" />
    <property role="qb" value="Qiy database model validation" />
    <property role="qc" value="./generated" />
    <node concept="qf" id="demoDatabase" role="qd">
      <property role="TrG5h" value="main" />
      <property role="qg" value="postgresql" />
      <property role="qh" value="drizzle" />
      <property role="qi" value="bun" />
      <property role="qj" value="postgres://localhost/qiy" />
    </node>
    <node concept="qk" id="demoUser" role="qe">
      <property role="TrG5h" value="User" />
      <property role="ql" value="users" />
      <property role="qm" value="public" />
      <property role="qn" value="true" />
      <node concept="qp" id="demoEmbedding" role="qo">
        <property role="TrG5h" value="embedding" />
        <property role="qq" value="Vector" />
        <property role="qr" value="embedding" />
        <property role="qx" value="pgvector" />
        <property role="ra" value="1536" />
      </node>
      <node concept="qp" id="demoInvalidEmbedding" role="qo">
        <property role="TrG5h" value="invalidEmbedding" />
        <property role="qq" value="Vector" />
        <property role="qr" value="invalid_embedding" />
        <property role="qx" value="" />
        <property role="ra" value="1536" />
      </node>
      <node concept="qp" id="demoInvalidDimension" role="qo">
        <property role="TrG5h" value="invalidDimension" />
        <property role="qq" value="Vector" />
        <property role="qr" value="invalid_dimension" />
        <property role="qx" value="pgvector" />
        <property role="ra" value="0" />
      </node>
      <node concept="qp" id="demoNegativeDimension" role="qo">
        <property role="TrG5h" value="negativeDimension" />
        <property role="qq" value="Vector" />
        <property role="qx" value="pgvector" />
        <property role="ra" value="-1" />
      </node>
      <node concept="qp" id="demoValidDecimal" role="qo">
        <property role="TrG5h" value="price" />
        <property role="qq" value="Decimal" />
        <property role="rb" value="12" />
        <property role="rc" value="2" />
      </node>
      <node concept="qp" id="demoInvalidMoneyPrecision" role="qo">
        <property role="TrG5h" value="invalidMoneyPrecision" />
        <property role="qq" value="Money" />
        <property role="rb" value="0" />
      </node>
      <node concept="qp" id="demoInvalidScale" role="qo">
        <property role="TrG5h" value="invalidScale" />
        <property role="qq" value="Decimal" />
        <property role="rb" value="4" />
        <property role="rc" value="5" />
      </node>
      <node concept="qp" id="demoNegativeScale" role="qo">
        <property role="TrG5h" value="negativeScale" />
        <property role="qq" value="Decimal" />
        <property role="rb" value="4" />
        <property role="rc" value="-1" />
      </node>
    </node>
  </node>
</model>

