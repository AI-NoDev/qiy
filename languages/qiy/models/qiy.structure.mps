<?xml version="1.0" encoding="UTF-8"?>
<model ref="r:cdc08ce6-9a71-4f69-89bd-83f257b06f70(qiy.structure)">
  <persistence version="9" />
  <languages>
    <devkit ref="78434eb8-b0e5-444b-850d-e7c4ad2da9ab(jetbrains.mps.devkit.aspect.structure)" />
  </languages>
  <imports>
    <import index="tpck" ref="r:00000000-0000-4000-0000-011c89590288(jetbrains.mps.lang.core.structure)" implicit="true" />
  </imports>
  <registry>
    <language id="c72da2b9-7cce-4447-8389-f407dc1158b7" name="jetbrains.mps.lang.structure">
      <concept id="1169125787135" name="jetbrains.mps.lang.structure.structure.AbstractConceptDeclaration" flags="ig" index="PkWjJ">
        <property id="6714410169261853888" name="conceptId" index="EcuMT" />
        <property id="5092175715804935370" name="conceptAlias" index="34LRSv" />
        <child id="1071489727083" name="linkDeclaration" index="1TKVEi" />
        <child id="1071489727084" name="propertyDeclaration" index="1TKVEl" />
      </concept>
      <concept id="1169127622168" name="jetbrains.mps.lang.structure.structure.InterfaceConceptReference" flags="ig" index="PrWs8">
        <reference id="1169127628841" name="intfc" index="PrY4T" />
      </concept>
      <concept id="1071489090640" name="jetbrains.mps.lang.structure.structure.ConceptDeclaration" flags="ig" index="1TIwiD">
        <property id="1096454100552" name="rootable" index="19KtqR" />
        <reference id="1071489389519" name="extends" index="1TJDcQ" />
        <child id="1169129564478" name="implements" index="PzmwI" />
      </concept>
      <concept id="1071489288299" name="jetbrains.mps.lang.structure.structure.PropertyDeclaration" flags="ig" index="1TJgyi">
        <property id="241647608299431129" name="propertyId" index="IQ2nx" />
        <reference id="1082985295845" name="dataType" index="AX2Wp" />
      </concept>
      <concept id="1071489288298" name="jetbrains.mps.lang.structure.structure.LinkDeclaration" flags="ig" index="1TJgyj">
        <property id="1071599776563" name="role" index="20kJfa" />
        <property id="1071599893252" name="sourceCardinality" index="20lbJX" />
        <property id="1071599937831" name="metaClass" index="20lmBu" />
        <property id="241647608299431140" name="linkId" index="IQ2ns" />
        <reference id="1071599976176" name="target" index="20lvS9" />
      </concept>
    </language>
    <language id="ceab5195-25ea-4f22-9b92-103b95ca8c0c" name="jetbrains.mps.lang.core">
      <concept id="1169194658468" name="jetbrains.mps.lang.core.structure.INamedConcept" flags="ngI" index="TrEIO">
        <property id="1169194664001" name="name" index="TrG5h" />
      </concept>
    </language>
  </registry>
  <node concept="1TIwiD" id="c720000000000000001">
    <property role="19KtqR" value="true" />
    <property role="TrG5h" value="Application" />
    <property role="34LRSv" value="application" />
    <property role="EcuMT" value="720000000000000001" />
    <ref role="1TJDcQ" to="tpck:gw2VY9q" resolve="BaseConcept" />
    <node concept="1TJgyi" id="p720000000000000101" role="1TKVEl">
      <property role="TrG5h" value="description" />
      <property role="IQ2nx" value="720000000000000101" />
      <ref role="AX2Wp" to="tpck:fKAOsGN" resolve="string" />
    </node>
    <node concept="1TJgyi" id="p720000000000000102" role="1TKVEl">
      <property role="TrG5h" value="basePath" />
      <property role="IQ2nx" value="720000000000000102" />
      <ref role="AX2Wp" to="tpck:fKAOsGN" resolve="string" />
    </node>
    <node concept="1TJgyi" id="p720000000000000104" role="1TKVEl">
      <property role="TrG5h" value="apiClient" />
      <property role="IQ2nx" value="720000000000000104" />
      <ref role="AX2Wp" to="tpck:fKAOsGN" resolve="string" />
    </node>
    <node concept="PrWs8" id="n720000000000000001" role="PzmwI">
      <ref role="PrY4T" to="tpck:h0TrEE$" resolve="INamedConcept" />
    </node>
    <node concept="1TJgyj" id="qiyApplicationDatabaseLink" role="1TKVEi">
      <property role="20lmBu" value="fLJjDmT/aggregation" />
      <property role="20kJfa" value="database" />
      <property role="20lbJX" value="fLJekj4/0..1" />
      <property role="IQ2ns" value="72000000000000101" />
      <ref role="20lvS9" node="c720000000000000002" resolve="DatabaseConfig" />
    </node>
    <node concept="1TJgyj" id="qiyApplicationEntitiesLink" role="1TKVEi">
      <property role="20lmBu" value="fLJjDmT/aggregation" />
      <property role="20kJfa" value="entities" />
      <property role="20lbJX" value="fLJekj5/0..n" />
      <property role="IQ2ns" value="72000000000000102" />
      <ref role="20lvS9" node="c720000000000000005" resolve="Entity" />
    </node>
    <node concept="1TJgyj" id="qiyApplicationRelationsLink" role="1TKVEi">
      <property role="20lmBu" value="fLJjDmT/aggregation" />
      <property role="20kJfa" value="relations" />
      <property role="20lbJX" value="fLJekj5/0..n" />
      <property role="IQ2ns" value="72000000000000103" />
      <ref role="20lvS9" node="c720000000000000011" resolve="Relation" />
    </node>
    <node concept="1TJgyj" id="qiyApplicationElysiaLink" role="1TKVEi">
      <property role="20lmBu" value="fLJjDmT/aggregation" />
      <property role="20kJfa" value="elysia" />
      <property role="20lbJX" value="fLJekj4/0..1" />
      <property role="IQ2ns" value="72000000000000105" />
      <ref role="20lvS9" node="c720000000000000012" resolve="ElysiaConfig" />
    </node>
    <node concept="1TJgyj" id="qiyApplicationStorageLink" role="1TKVEi">
      <property role="20lmBu" value="fLJjDmT/aggregation" />
      <property role="20kJfa" value="storage" />
      <property role="20lbJX" value="fLJekj4/0..1" />
      <property role="IQ2ns" value="72000000000000106" />
      <ref role="20lvS9" node="c720000000000000015" resolve="StorageConfig" />
    </node>
    <node concept="1TJgyj" id="qiyApplicationAuthLink" role="1TKVEi">
      <property role="20lmBu" value="fLJjDmT/aggregation" />
      <property role="20kJfa" value="auth" />
      <property role="20lbJX" value="fLJekj4/0..1" />
      <property role="IQ2ns" value="72000000000000107" />
      <ref role="20lvS9" node="c720000000000000016" resolve="AuthConfig" />
    </node>
    <node concept="1TJgyj" id="qiyApplicationScopesLink" role="1TKVEi">
      <property role="20lmBu" value="fLJjDmT/aggregation" />
      <property role="20kJfa" value="scopes" />
      <property role="20lbJX" value="fLJekj5/0..n" />
      <property role="IQ2ns" value="72000000000000108" />
      <ref role="20lvS9" node="c720000000000000017" resolve="ScopeConfig" />
    </node>
    <node concept="1TJgyj" id="qiyApplicationMenuGroupsLink" role="1TKVEi">
      <property role="20lmBu" value="fLJjDmT/aggregation" />
      <property role="20kJfa" value="menuGroups" />
      <property role="20lbJX" value="fLJekj5/0..n" />
      <property role="IQ2ns" value="72000000000000109" />
      <ref role="20lvS9" node="c720000000000000018" resolve="MenuGroup" />
    </node>
    <node concept="1TJgyj" id="qiyApplicationDashboardMetricsLink" role="1TKVEi">
      <property role="20lmBu" value="fLJjDmT/aggregation" />
      <property role="20kJfa" value="dashboardMetrics" />
      <property role="20lbJX" value="fLJekj5/0..n" />
      <property role="IQ2ns" value="72000000000000110" />
      <ref role="20lvS9" node="c720000000000000020" resolve="DashboardMetric" />
    </node>
    <node concept="1TJgyj" id="qiyApplicationEnumsLink" role="1TKVEi">
      <property role="20lmBu" value="fLJjDmT/aggregation" />
      <property role="20kJfa" value="enums" />
      <property role="20lbJX" value="fLJekj5/0..n" />
      <property role="IQ2ns" value="72000000000000111" />
      <ref role="20lvS9" node="c720000000000000021" resolve="Enum" />
    </node>
    <node concept="1TJgyj" id="qiyApplicationWorkflowsLink" role="1TKVEi">
      <property role="20lmBu" value="fLJjDmT/aggregation" />
      <property role="20kJfa" value="workflows" />
      <property role="20lbJX" value="fLJekj5/0..n" />
      <property role="IQ2ns" value="72000000000000112" />
      <ref role="20lvS9" node="c720000000000000023" resolve="WorkflowConfig" />
    </node>
  </node>
  <node concept="1TIwiD" id="c720000000000000018">
    <property role="TrG5h" value="MenuGroup" />
    <property role="34LRSv" value="menu-group" />
    <property role="EcuMT" value="720000000000000018" />
    <ref role="1TJDcQ" to="tpck:gw2VY9q" resolve="BaseConcept" />
    <node concept="1TJgyi" id="p720000000000001801" role="1TKVEl"><property role="TrG5h" value="label" /><property role="IQ2nx" value="720000000000001801" /><ref role="AX2Wp" to="tpck:fKAOsGN" resolve="string" /></node>
    <node concept="1TJgyi" id="p720000000000001802" role="1TKVEl"><property role="TrG5h" value="icon" /><property role="IQ2nx" value="720000000000001802" /><ref role="AX2Wp" to="tpck:fKAOsGN" resolve="string" /></node>
    <node concept="1TJgyi" id="p720000000000001803" role="1TKVEl"><property role="TrG5h" value="parent" /><property role="IQ2nx" value="720000000000001803" /><ref role="AX2Wp" to="tpck:fKAOsGN" resolve="string" /></node>
    <node concept="1TJgyj" id="qiyMenuGroupResourcesLink" role="1TKVEi"><property role="20lmBu" value="fLJjDmT/aggregation" /><property role="20kJfa" value="resources" /><property role="20lbJX" value="fLJekj5/0..n" /><property role="IQ2ns" value="72000000000001801" /><ref role="20lvS9" node="c720000000000000019" resolve="MenuResource" /></node>
    <node concept="PrWs8" id="n720000000000000018" role="PzmwI"><ref role="PrY4T" to="tpck:h0TrEE$" resolve="INamedConcept" /></node>
  </node>
  <node concept="1TIwiD" id="c720000000000000019">
    <property role="TrG5h" value="MenuResource" />
    <property role="34LRSv" value="menu-resource" />
    <property role="EcuMT" value="720000000000000019" />
    <ref role="1TJDcQ" to="tpck:gw2VY9q" resolve="BaseConcept" />
    <node concept="1TJgyi" id="p720000000000001901" role="1TKVEl"><property role="TrG5h" value="resource" /><property role="IQ2nx" value="720000000000001901" /><ref role="AX2Wp" to="tpck:fKAOsGN" resolve="string" /></node>
  </node>
  <node concept="1TIwiD" id="c720000000000000020">
    <property role="TrG5h" value="DashboardMetric" />
    <property role="34LRSv" value="dashboard-metric" />
    <property role="EcuMT" value="720000000000000020" />
    <ref role="1TJDcQ" to="tpck:gw2VY9q" resolve="BaseConcept" />
    <node concept="1TJgyi" id="p720000000000002001" role="1TKVEl"><property role="TrG5h" value="resource" /><property role="IQ2nx" value="720000000000002001" /><ref role="AX2Wp" to="tpck:fKAOsGN" resolve="string" /></node>
    <node concept="1TJgyi" id="p720000000000002002" role="1TKVEl"><property role="TrG5h" value="label" /><property role="IQ2nx" value="720000000000002002" /><ref role="AX2Wp" to="tpck:fKAOsGN" resolve="string" /></node>
    <node concept="1TJgyi" id="p720000000000002003" role="1TKVEl"><property role="TrG5h" value="icon" /><property role="IQ2nx" value="720000000000002003" /><ref role="AX2Wp" to="tpck:fKAOsGN" resolve="string" /></node>
    <node concept="1TJgyi" id="p720000000000002004" role="1TKVEl"><property role="TrG5h" value="span" /><property role="IQ2nx" value="720000000000002004" /><ref role="AX2Wp" to="tpck:fKAQMTA" resolve="integer" /></node>
    <node concept="1TJgyi" id="p720000000000002005" role="1TKVEl"><property role="TrG5h" value="type" /><property role="IQ2nx" value="720000000000002005" /><ref role="AX2Wp" to="tpck:fKAOsGN" resolve="string" /></node>
    <node concept="1TJgyi" id="p720000000000002006" role="1TKVEl"><property role="TrG5h" value="groupBy" /><property role="IQ2nx" value="720000000000002006" /><ref role="AX2Wp" to="tpck:fKAOsGN" resolve="string" /></node>
    <node concept="1TJgyi" id="p720000000000002007" role="1TKVEl"><property role="TrG5h" value="days" /><property role="IQ2nx" value="720000000000002007" /><ref role="AX2Wp" to="tpck:fKAQMTA" resolve="integer" /></node>
    <node concept="PrWs8" id="n720000000000000020" role="PzmwI"><ref role="PrY4T" to="tpck:h0TrEE$" resolve="INamedConcept" /></node>
  </node>
  <node concept="1TIwiD" id="c720000000000000021">
    <property role="TrG5h" value="Enum" />
    <property role="34LRSv" value="enum" />
    <property role="EcuMT" value="720000000000000021" />
    <ref role="1TJDcQ" to="tpck:gw2VY9q" resolve="BaseConcept" />
    <node concept="1TJgyj" id="qiyEnumValuesLink" role="1TKVEi"><property role="20lmBu" value="fLJjDmT/aggregation" /><property role="20kJfa" value="values" /><property role="20lbJX" value="fLJekj5/0..n" /><property role="IQ2ns" value="72000000000002101" /><ref role="20lvS9" node="c720000000000000022" resolve="EnumValue" /></node>
    <node concept="PrWs8" id="n720000000000000021" role="PzmwI"><ref role="PrY4T" to="tpck:h0TrEE$" resolve="INamedConcept" /></node>
  </node>
  <node concept="1TIwiD" id="c720000000000000022">
    <property role="TrG5h" value="EnumValue" />
    <property role="34LRSv" value="enum-value" />
    <property role="EcuMT" value="720000000000000022" />
    <ref role="1TJDcQ" to="tpck:gw2VY9q" resolve="BaseConcept" />
    <node concept="1TJgyi" id="p720000000000002201" role="1TKVEl"><property role="TrG5h" value="label" /><property role="IQ2nx" value="720000000000002201" /><ref role="AX2Wp" to="tpck:fKAOsGN" resolve="string" /></node>
    <node concept="1TJgyi" id="p720000000000002202" role="1TKVEl"><property role="TrG5h" value="color" /><property role="IQ2nx" value="720000000000002202" /><ref role="AX2Wp" to="tpck:fKAOsGN" resolve="string" /></node>
    <node concept="1TJgyi" id="p720000000000002203" role="1TKVEl"><property role="TrG5h" value="icon" /><property role="IQ2nx" value="720000000000002203" /><ref role="AX2Wp" to="tpck:fKAOsGN" resolve="string" /></node>
    <node concept="PrWs8" id="n720000000000000022" role="PzmwI"><ref role="PrY4T" to="tpck:h0TrEE$" resolve="INamedConcept" /></node>
  </node>
  <node concept="1TIwiD" id="c720000000000000017">
    <property role="TrG5h" value="ScopeConfig" />
    <property role="34LRSv" value="scope" />
    <property role="EcuMT" value="720000000000000017" />
    <ref role="1TJDcQ" to="tpck:gw2VY9q" resolve="BaseConcept" />
    <node concept="1TJgyi" id="p720000000000001701" role="1TKVEl">
      <property role="TrG5h" value="resource" />
      <property role="IQ2nx" value="720000000000001701" />
      <ref role="AX2Wp" to="tpck:fKAOsGN" resolve="string" />
    </node>
    <node concept="1TJgyi" id="p720000000000001702" role="1TKVEl">
      <property role="TrG5h" value="field" />
      <property role="IQ2nx" value="720000000000001702" />
      <ref role="AX2Wp" to="tpck:fKAOsGN" resolve="string" />
    </node>
    <node concept="1TJgyi" id="p720000000000001703" role="1TKVEl">
      <property role="TrG5h" value="claim" />
      <property role="IQ2nx" value="720000000000001703" />
      <ref role="AX2Wp" to="tpck:fKAOsGN" resolve="string" />
    </node>
  </node>
  <node concept="1TIwiD" id="c720000000000000016">
    <property role="TrG5h" value="AuthConfig" />
    <property role="34LRSv" value="auth" />
    <property role="EcuMT" value="720000000000000016" />
    <ref role="1TJDcQ" to="tpck:gw2VY9q" resolve="BaseConcept" />
    <node concept="1TJgyi" id="p720000000000001601" role="1TKVEl">
      <property role="TrG5h" value="provider" />
      <property role="IQ2nx" value="720000000000001601" />
      <ref role="AX2Wp" to="tpck:fKAOsGN" resolve="string" />
    </node>
    <node concept="1TJgyi" id="p720000000000001602" role="1TKVEl">
      <property role="TrG5h" value="userEntity" />
      <property role="IQ2nx" value="720000000000001602" />
      <ref role="AX2Wp" to="tpck:fKAOsGN" resolve="string" />
    </node>
    <node concept="1TJgyi" id="p720000000000001603" role="1TKVEl">
      <property role="TrG5h" value="subjectField" />
      <property role="IQ2nx" value="720000000000001603" />
      <ref role="AX2Wp" to="tpck:fKAOsGN" resolve="string" />
    </node>
    <node concept="1TJgyi" id="p720000000000001604" role="1TKVEl">
      <property role="TrG5h" value="roleField" />
      <property role="IQ2nx" value="720000000000001604" />
      <ref role="AX2Wp" to="tpck:fKAOsGN" resolve="string" />
    </node>
  </node>
  <node concept="1TIwiD" id="c720000000000000015">
    <property role="TrG5h" value="StorageConfig" />
    <property role="34LRSv" value="storage" />
    <property role="EcuMT" value="720000000000000015" />
    <ref role="1TJDcQ" to="tpck:gw2VY9q" resolve="BaseConcept" />
    <node concept="1TJgyi" id="p720000000000001501" role="1TKVEl">
      <property role="TrG5h" value="provider" />
      <property role="IQ2nx" value="720000000000001501" />
      <ref role="AX2Wp" to="tpck:fKAOsGN" resolve="string" />
    </node>
  </node>
  <node concept="1TIwiD" id="c720000000000000012">
    <property role="TrG5h" value="ElysiaConfig" />
    <property role="34LRSv" value="elysia" />
    <property role="EcuMT" value="720000000000000012" />
    <ref role="1TJDcQ" to="tpck:gw2VY9q" resolve="BaseConcept" />
    <node concept="1TJgyi" id="p720000000000001201" role="1TKVEl">
      <property role="TrG5h" value="bearer" />
      <property role="IQ2nx" value="720000000000001201" />
      <ref role="AX2Wp" to="tpck:fKAQMTB" resolve="boolean" />
    </node>
    <node concept="1TJgyi" id="p720000000000001202" role="1TKVEl">
      <property role="TrG5h" value="serverTiming" />
      <property role="IQ2nx" value="720000000000001202" />
      <ref role="AX2Wp" to="tpck:fKAQMTB" resolve="boolean" />
    </node>
    <node concept="1TJgyi" id="p720000000000001203" role="1TKVEl">
      <property role="TrG5h" value="graphqlAdapter" />
      <property role="IQ2nx" value="720000000000001203" />
      <ref role="AX2Wp" to="tpck:fKAOsGN" resolve="string" />
    </node>
    <node concept="1TJgyi" id="p720000000000001204" role="1TKVEl">
      <property role="TrG5h" value="jwt" />
      <property role="IQ2nx" value="720000000000001204" />
      <ref role="AX2Wp" to="tpck:fKAQMTB" resolve="boolean" />
    </node>
    <node concept="1TJgyi" id="p720000000000001205" role="1TKVEl">
      <property role="TrG5h" value="static" />
      <property role="IQ2nx" value="720000000000001205" />
      <ref role="AX2Wp" to="tpck:fKAQMTB" resolve="boolean" />
    </node>
    <node concept="1TJgyi" id="p720000000000001206" role="1TKVEl">
      <property role="TrG5h" value="html" />
      <property role="IQ2nx" value="720000000000001206" />
      <ref role="AX2Wp" to="tpck:fKAQMTB" resolve="boolean" />
    </node>
    <node concept="1TJgyi" id="p720000000000001207" role="1TKVEl">
      <property role="TrG5h" value="drizzle" />
      <property role="IQ2nx" value="720000000000001207" />
      <ref role="AX2Wp" to="tpck:fKAQMTB" resolve="boolean" />
    </node>
    <node concept="1TJgyj" id="qiyElysiaCronLink" role="1TKVEi">
      <property role="20lmBu" value="fLJjDmT/aggregation" />
      <property role="20kJfa" value="cron" />
      <property role="20lbJX" value="fLJekj4/0..1" />
      <property role="IQ2ns" value="72000000000001203" />
      <ref role="20lvS9" node="c720000000000000013" resolve="CronConfig" />
    </node>
  </node>
  <node concept="1TIwiD" id="c720000000000000013">
    <property role="TrG5h" value="CronConfig" />
    <property role="34LRSv" value="cron" />
    <property role="EcuMT" value="720000000000000013" />
    <ref role="1TJDcQ" to="tpck:gw2VY9q" resolve="BaseConcept" />
    <node concept="1TJgyj" id="qiyCronJobsLink" role="1TKVEi">
      <property role="20lmBu" value="fLJjDmT/aggregation" />
      <property role="20kJfa" value="jobs" />
      <property role="20lbJX" value="fLJekj6/1..n" />
      <property role="IQ2ns" value="72000000000001301" />
      <ref role="20lvS9" node="c720000000000000014" resolve="CronJob" />
    </node>
  </node>
  <node concept="1TIwiD" id="c720000000000000014">
    <property role="TrG5h" value="CronJob" />
    <property role="34LRSv" value="job" />
    <property role="EcuMT" value="720000000000000014" />
    <ref role="1TJDcQ" to="tpck:gw2VY9q" resolve="BaseConcept" />
    <node concept="1TJgyi" id="p720000000000001401" role="1TKVEl">
      <property role="TrG5h" value="pattern" />
      <property role="IQ2nx" value="720000000000001401" />
      <ref role="AX2Wp" to="tpck:fKAOsGN" resolve="string" />
    </node>
    <node concept="1TJgyi" id="p720000000000001402" role="1TKVEl">
      <property role="TrG5h" value="task" />
      <property role="IQ2nx" value="720000000000001402" />
      <ref role="AX2Wp" to="tpck:fKAOsGN" resolve="string" />
    </node>
    <node concept="PrWs8" id="n720000000000000014" role="PzmwI">
      <ref role="PrY4T" to="tpck:h0TrEE$" resolve="INamedConcept" />
    </node>
  </node>
  <node concept="1TIwiD" id="c720000000000000002">
    <property role="TrG5h" value="DatabaseConfig" />
    <property role="34LRSv" value="database" />
    <property role="EcuMT" value="720000000000000002" />
    <ref role="1TJDcQ" to="tpck:gw2VY9q" resolve="BaseConcept" />
    <node concept="1TJgyi" id="p720000000000000201" role="1TKVEl">
      <property role="TrG5h" value="dialect" />
      <property role="IQ2nx" value="720000000000000201" />
      <ref role="AX2Wp" to="tpck:fKAOsGN" resolve="string" />
    </node>
    <node concept="1TJgyi" id="p720000000000000202" role="1TKVEl">
      <property role="TrG5h" value="orm" />
      <property role="IQ2nx" value="720000000000000202" />
      <ref role="AX2Wp" to="tpck:fKAOsGN" resolve="string" />
    </node>
    <node concept="1TJgyi" id="p720000000000000203" role="1TKVEl">
      <property role="TrG5h" value="provider" />
      <property role="IQ2nx" value="720000000000000203" />
      <ref role="AX2Wp" to="tpck:fKAOsGN" resolve="string" />
    </node>
    <node concept="1TJgyi" id="p720000000000000204" role="1TKVEl">
      <property role="TrG5h" value="url" />
      <property role="IQ2nx" value="720000000000000204" />
      <ref role="AX2Wp" to="tpck:fKAOsGN" resolve="string" />
    </node>
    <node concept="PrWs8" id="n720000000000000002" role="PzmwI">
      <ref role="PrY4T" to="tpck:h0TrEE$" resolve="INamedConcept" />
    </node>
    <node concept="1TJgyj" id="qiyDatabaseExtensionsLink" role="1TKVEi">
      <property role="20lmBu" value="fLJjDmT/aggregation" />
      <property role="20kJfa" value="extensions" />
      <property role="20lbJX" value="fLJekj5/0..n" />
      <property role="IQ2ns" value="72000000000000201" />
      <ref role="20lvS9" node="c720000000000000003" resolve="DatabaseExtension" />
    </node>
    <node concept="1TJgyj" id="l72000000000000202" role="1TKVEi">
      <property role="20lmBu" value="fLJjDmT/aggregation" />
      <property role="20kJfa" value="optimization" />
      <property role="20lbJX" value="fLJekj4/0..1" />
      <property role="IQ2ns" value="72000000000000202" />
      <ref role="20lvS9" node="c720000000000000004" resolve="DatabaseOptimization" />
    </node>
    <node concept="1TJgyj" id="l72000000000000203" role="1TKVEi">
      <property role="20lmBu" value="fLJjDmT/aggregation" />
      <property role="20kJfa" value="capabilities" />
      <property role="20lbJX" value="fLJekj5/0..n" />
      <property role="IQ2ns" value="72000000000000203" />
      <ref role="20lvS9" node="c720000000000000010" resolve="CapabilityRequirement" />
    </node>
  </node>
  <node concept="1TIwiD" id="c720000000000000003">
    <property role="TrG5h" value="DatabaseExtension" />
    <property role="34LRSv" value="extension" />
    <property role="EcuMT" value="720000000000000003" />
    <ref role="1TJDcQ" to="tpck:gw2VY9q" resolve="BaseConcept" />
    <node concept="1TJgyi" id="p720000000000000301" role="1TKVEl">
      <property role="TrG5h" value="version" />
      <property role="IQ2nx" value="720000000000000301" />
      <ref role="AX2Wp" to="tpck:fKAOsGN" resolve="string" />
    </node>
    <node concept="1TJgyi" id="p720000000000000302" role="1TKVEl">
      <property role="TrG5h" value="required" />
      <property role="IQ2nx" value="720000000000000302" />
      <ref role="AX2Wp" to="tpck:fKAQMTB" resolve="boolean" />
    </node>
    <node concept="1TJgyi" id="p720000000000000303" role="1TKVEl">
      <property role="TrG5h" value="installMode" />
      <property role="IQ2nx" value="720000000000000303" />
      <ref role="AX2Wp" to="tpck:fKAOsGN" resolve="string" />
    </node>
    <node concept="1TJgyi" id="p720000000000000304" role="1TKVEl">
      <property role="TrG5h" value="minVersion" />
      <property role="IQ2nx" value="720000000000000304" />
      <ref role="AX2Wp" to="tpck:fKAOsGN" resolve="string" />
    </node>
    <node concept="PrWs8" id="n720000000000000003" role="PzmwI">
      <ref role="PrY4T" to="tpck:h0TrEE$" resolve="INamedConcept" />
    </node>
  </node>
  <node concept="1TIwiD" id="c720000000000000004">
    <property role="TrG5h" value="DatabaseOptimization" />
    <property role="34LRSv" value="database-options" />
    <property role="EcuMT" value="720000000000000004" />
    <ref role="1TJDcQ" to="tpck:gw2VY9q" resolve="BaseConcept" />
    <node concept="1TJgyi" id="p720000000000000401" role="1TKVEl">
      <property role="TrG5h" value="poolMin" />
      <property role="IQ2nx" value="720000000000000401" />
      <ref role="AX2Wp" to="tpck:fKAQMTA" resolve="integer" />
    </node>
    <node concept="1TJgyi" id="p720000000000000402" role="1TKVEl">
      <property role="TrG5h" value="poolMax" />
      <property role="IQ2nx" value="720000000000000402" />
      <ref role="AX2Wp" to="tpck:fKAQMTA" resolve="integer" />
    </node>
    <node concept="1TJgyi" id="p720000000000000403" role="1TKVEl">
      <property role="TrG5h" value="queryTimeoutMs" />
      <property role="IQ2nx" value="720000000000000403" />
      <ref role="AX2Wp" to="tpck:fKAQMTA" resolve="integer" />
    </node>
    <node concept="1TJgyi" id="p720000000000000404" role="1TKVEl">
      <property role="TrG5h" value="statementTimeoutMs" />
      <property role="IQ2nx" value="720000000000000404" />
      <ref role="AX2Wp" to="tpck:fKAQMTA" resolve="integer" />
    </node>
    <node concept="1TJgyi" id="p720000000000000405" role="1TKVEl">
      <property role="TrG5h" value="lockTimeoutMs" />
      <property role="IQ2nx" value="720000000000000405" />
      <ref role="AX2Wp" to="tpck:fKAQMTA" resolve="integer" />
    </node>
    <node concept="1TJgyi" id="p720000000000000406" role="1TKVEl">
      <property role="TrG5h" value="readReplicaUrl" />
      <property role="IQ2nx" value="720000000000000406" />
      <ref role="AX2Wp" to="tpck:fKAOsGN" resolve="string" />
    </node>
    <node concept="1TJgyi" id="p720000000000000407" role="1TKVEl">
      <property role="TrG5h" value="transactionIsolation" />
      <property role="IQ2nx" value="720000000000000407" />
      <ref role="AX2Wp" to="tpck:fKAOsGN" resolve="string" />
    </node>
    <node concept="1TJgyi" id="p720000000000000408" role="1TKVEl">
      <property role="TrG5h" value="preparedStatements" />
      <property role="IQ2nx" value="720000000000000408" />
      <ref role="AX2Wp" to="tpck:fKAQMTB" resolve="boolean" />
    </node>
    <node concept="1TJgyi" id="p720000000000000409" role="1TKVEl">
      <property role="TrG5h" value="batchSize" />
      <property role="IQ2nx" value="720000000000000409" />
      <ref role="AX2Wp" to="tpck:fKAQMTA" resolve="integer" />
    </node>
    <node concept="1TJgyi" id="p720000000000000410" role="1TKVEl">
      <property role="TrG5h" value="paginationStrategy" />
      <property role="IQ2nx" value="720000000000000410" />
      <ref role="AX2Wp" to="tpck:fKAOsGN" resolve="string" />
    </node>
    <node concept="1TJgyi" id="p720000000000000411" role="1TKVEl">
      <property role="TrG5h" value="cachePolicy" />
      <property role="IQ2nx" value="720000000000000411" />
      <ref role="AX2Wp" to="tpck:fKAOsGN" resolve="string" />
    </node>
    <node concept="PrWs8" id="n720000000000000004" role="PzmwI">
      <ref role="PrY4T" to="tpck:h0TrEE$" resolve="INamedConcept" />
    </node>
  </node>
  <node concept="1TIwiD" id="c720000000000000005">
    <property role="TrG5h" value="Entity" />
    <property role="34LRSv" value="entity" />
    <property role="EcuMT" value="720000000000000005" />
    <ref role="1TJDcQ" to="tpck:gw2VY9q" resolve="BaseConcept" />
    <node concept="1TJgyi" id="p720000000000000501" role="1TKVEl">
      <property role="TrG5h" value="tableName" />
      <property role="IQ2nx" value="720000000000000501" />
      <ref role="AX2Wp" to="tpck:fKAOsGN" resolve="string" />
    </node>
    <node concept="1TJgyi" id="p720000000000000502" role="1TKVEl">
      <property role="TrG5h" value="schema" />
      <property role="IQ2nx" value="720000000000000502" />
      <ref role="AX2Wp" to="tpck:fKAOsGN" resolve="string" />
    </node>
    <node concept="1TJgyi" id="p720000000000000503" role="1TKVEl">
      <property role="TrG5h" value="timestamps" />
      <property role="IQ2nx" value="720000000000000503" />
      <ref role="AX2Wp" to="tpck:fKAQMTB" resolve="boolean" />
    </node>
    <node concept="PrWs8" id="n720000000000000005" role="PzmwI">
      <ref role="PrY4T" to="tpck:h0TrEE$" resolve="INamedConcept" />
    </node>
    <node concept="1TJgyj" id="qiyEntityFieldsLink" role="1TKVEi">
      <property role="20lmBu" value="fLJjDmT/aggregation" />
      <property role="20kJfa" value="fields" />
      <property role="20lbJX" value="fLJekj5/0..n" />
      <property role="IQ2ns" value="72000000000000501" />
      <ref role="20lvS9" node="c720000000000000006" resolve="Field" />
    </node>
    <node concept="1TJgyj" id="qiyEntityIndexesLink" role="1TKVEi">
      <property role="20lmBu" value="fLJjDmT/aggregation" />
      <property role="20kJfa" value="indexes" />
      <property role="20lbJX" value="fLJekj5/0..n" />
      <property role="IQ2ns" value="72000000000000502" />
      <ref role="20lvS9" node="c720000000000000007" resolve="Index" />
    </node>
    <node concept="1TJgyj" id="l72000000000000503" role="1TKVEi">
      <property role="20lmBu" value="fLJjDmT/aggregation" />
      <property role="20kJfa" value="constraints" />
      <property role="20lbJX" value="fLJekj5/0..n" />
      <property role="IQ2ns" value="72000000000000503" />
      <ref role="20lvS9" node="c720000000000000009" resolve="Constraint" />
    </node>
  </node>
  <node concept="1TIwiD" id="c720000000000000006">
    <property role="TrG5h" value="Field" />
    <property role="34LRSv" value="field" />
    <property role="EcuMT" value="720000000000000006" />
    <ref role="1TJDcQ" to="tpck:gw2VY9q" resolve="BaseConcept" />
    <node concept="1TJgyi" id="p720000000000000601" role="1TKVEl">
      <property role="TrG5h" value="type" />
      <property role="IQ2nx" value="720000000000000601" />
      <ref role="AX2Wp" to="tpck:fKAOsGN" resolve="string" />
    </node>
    <node concept="1TJgyi" id="p720000000000000602" role="1TKVEl">
      <property role="TrG5h" value="columnName" />
      <property role="IQ2nx" value="720000000000000602" />
      <ref role="AX2Wp" to="tpck:fKAOsGN" resolve="string" />
    </node>
    <node concept="1TJgyi" id="p720000000000000603" role="1TKVEl">
      <property role="TrG5h" value="nullable" />
      <property role="IQ2nx" value="720000000000000603" />
      <ref role="AX2Wp" to="tpck:fKAOsGN" resolve="string" />
    </node>
    <node concept="1TJgyi" id="p720000000000000604" role="1TKVEl">
      <property role="TrG5h" value="primaryKey" />
      <property role="IQ2nx" value="720000000000000604" />
      <ref role="AX2Wp" to="tpck:fKAOsGN" resolve="string" />
    </node>
    <node concept="1TJgyi" id="p720000000000000605" role="1TKVEl">
      <property role="TrG5h" value="unique" />
      <property role="IQ2nx" value="720000000000000605" />
      <ref role="AX2Wp" to="tpck:fKAOsGN" resolve="string" />
    </node>
    <node concept="1TJgyi" id="p720000000000000606" role="1TKVEl">
      <property role="TrG5h" value="defaultExpression" />
      <property role="IQ2nx" value="720000000000000606" />
      <ref role="AX2Wp" to="tpck:fKAOsGN" resolve="string" />
    </node>
    <node concept="1TJgyi" id="p720000000000000607" role="1TKVEl">
      <property role="TrG5h" value="generated" />
      <property role="IQ2nx" value="720000000000000607" />
      <ref role="AX2Wp" to="tpck:fKAQMTB" resolve="boolean" />
    </node>
    <node concept="1TJgyi" id="p720000000000000608" role="1TKVEl">
      <property role="TrG5h" value="extension" />
      <property role="IQ2nx" value="720000000000000608" />
      <ref role="AX2Wp" to="tpck:fKAOsGN" resolve="string" />
    </node>
    <node concept="1TJgyi" id="p720000000000000609" role="1TKVEl">
      <property role="TrG5h" value="softDelete" />
      <property role="IQ2nx" value="720000000000000609" />
      <ref role="AX2Wp" to="tpck:fKAQMTB" resolve="boolean" />
    </node>
    <node concept="1TJgyi" id="p720000000000000610" role="1TKVEl">
      <property role="TrG5h" value="optimisticLock" />
      <property role="IQ2nx" value="720000000000000610" />
      <ref role="AX2Wp" to="tpck:fKAQMTB" resolve="boolean" />
    </node>
    <node concept="1TJgyi" id="p720000000000000611" role="1TKVEl">
      <property role="TrG5h" value="dimension" />
      <property role="IQ2nx" value="720000000000000611" />
      <ref role="AX2Wp" to="tpck:fKAQMTA" resolve="integer" />
    </node>
    <node concept="1TJgyi" id="p720000000000000612" role="1TKVEl">
      <property role="TrG5h" value="precision" />
      <property role="IQ2nx" value="720000000000000612" />
      <ref role="AX2Wp" to="tpck:fKAQMTA" resolve="integer" />
    </node>
    <node concept="1TJgyi" id="p720000000000000613" role="1TKVEl">
      <property role="TrG5h" value="scale" />
      <property role="IQ2nx" value="720000000000000613" />
      <ref role="AX2Wp" to="tpck:fKAOsGN" resolve="string" />
    </node>
    <node concept="1TJgyi" id="p720000000000000614" role="1TKVEl">
      <property role="TrG5h" value="visible" />
      <property role="IQ2nx" value="720000000000000614" />
      <ref role="AX2Wp" to="tpck:fKAOsGN" resolve="string" />
    </node>
    <node concept="1TJgyi" id="p720000000000000615" role="1TKVEl">
      <property role="TrG5h" value="listVisible" />
      <property role="IQ2nx" value="720000000000000615" />
      <ref role="AX2Wp" to="tpck:fKAOsGN" resolve="string" />
    </node>
    <node concept="1TJgyi" id="p720000000000000616" role="1TKVEl">
      <property role="TrG5h" value="formVisible" />
      <property role="IQ2nx" value="720000000000000616" />
      <ref role="AX2Wp" to="tpck:fKAOsGN" resolve="string" />
    </node>
    <node concept="1TJgyi" id="p720000000000000617" role="1TKVEl">
      <property role="TrG5h" value="showVisible" />
      <property role="IQ2nx" value="720000000000000617" />
      <ref role="AX2Wp" to="tpck:fKAOsGN" resolve="string" />
    </node>
    <node concept="1TJgyi" id="p720000000000000618" role="1TKVEl">
      <property role="TrG5h" value="sortable" />
      <property role="IQ2nx" value="720000000000000618" />
      <ref role="AX2Wp" to="tpck:fKAOsGN" resolve="string" />
    </node>
    <node concept="1TJgyi" id="p720000000000000619" role="1TKVEl">
      <property role="TrG5h" value="filterable" />
      <property role="IQ2nx" value="720000000000000619" />
      <ref role="AX2Wp" to="tpck:fKAOsGN" resolve="string" />
    </node>
    <node concept="1TJgyi" id="p720000000000000620" role="1TKVEl">
      <property role="TrG5h" value="label" />
      <property role="IQ2nx" value="720000000000000620" />
      <ref role="AX2Wp" to="tpck:fKAOsGN" resolve="string" />
    </node>
    <node concept="1TJgyi" id="p720000000000000621" role="1TKVEl">
      <property role="TrG5h" value="icon" />
      <property role="IQ2nx" value="720000000000000621" />
      <ref role="AX2Wp" to="tpck:fKAOsGN" resolve="string" />
    </node>
    <node concept="PrWs8" id="n720000000000000006" role="PzmwI">
      <ref role="PrY4T" to="tpck:h0TrEE$" resolve="INamedConcept" />
    </node>
  </node>
  <node concept="1TIwiD" id="c720000000000000007">
    <property role="TrG5h" value="Index" />
    <property role="34LRSv" value="index" />
    <property role="EcuMT" value="720000000000000007" />
    <ref role="1TJDcQ" to="tpck:gw2VY9q" resolve="BaseConcept" />
    <node concept="1TJgyi" id="p720000000000000701" role="1TKVEl">
      <property role="TrG5h" value="method" />
      <property role="IQ2nx" value="720000000000000701" />
      <ref role="AX2Wp" to="tpck:fKAOsGN" resolve="string" />
    </node>
    <node concept="1TJgyi" id="p720000000000000702" role="1TKVEl">
      <property role="TrG5h" value="unique" />
      <property role="IQ2nx" value="720000000000000702" />
      <ref role="AX2Wp" to="tpck:fKAOsGN" resolve="string" />
    </node>
    <node concept="1TJgyi" id="p720000000000000703" role="1TKVEl">
      <property role="TrG5h" value="where" />
      <property role="IQ2nx" value="720000000000000703" />
      <ref role="AX2Wp" to="tpck:fKAOsGN" resolve="string" />
    </node>
    <node concept="1TJgyi" id="p720000000000000704" role="1TKVEl">
      <property role="TrG5h" value="concurrently" />
      <property role="IQ2nx" value="720000000000000704" />
      <ref role="AX2Wp" to="tpck:fKAOsGN" resolve="string" />
    </node>
    <node concept="1TJgyi" id="p720000000000000705" role="1TKVEl">
      <property role="TrG5h" value="include" />
      <property role="IQ2nx" value="720000000000000705" />
      <ref role="AX2Wp" to="tpck:fKAOsGN" resolve="string" />
    </node>
    <node concept="PrWs8" id="n720000000000000007" role="PzmwI">
      <ref role="PrY4T" to="tpck:h0TrEE$" resolve="INamedConcept" />
    </node>
    <node concept="1TJgyj" id="qiyIndexColumnsLink" role="1TKVEi">
      <property role="20lmBu" value="fLJjDmT/aggregation" />
      <property role="20kJfa" value="columns" />
      <property role="20lbJX" value="fLJekj6/1..n" />
      <property role="IQ2ns" value="72000000000000701" />
      <ref role="20lvS9" node="c720000000000000008" resolve="IndexColumn" />
    </node>
  </node>
  <node concept="1TIwiD" id="c720000000000000008">
    <property role="TrG5h" value="IndexColumn" />
    <property role="34LRSv" value="index-column" />
    <property role="EcuMT" value="720000000000000008" />
    <ref role="1TJDcQ" to="tpck:gw2VY9q" resolve="BaseConcept" />
    <node concept="1TJgyi" id="p720000000000000801" role="1TKVEl">
      <property role="TrG5h" value="fieldName" />
      <property role="IQ2nx" value="720000000000000801" />
      <ref role="AX2Wp" to="tpck:fKAOsGN" resolve="string" />
    </node>
    <node concept="1TJgyi" id="p720000000000000802" role="1TKVEl">
      <property role="TrG5h" value="expression" />
      <property role="IQ2nx" value="720000000000000802" />
      <ref role="AX2Wp" to="tpck:fKAOsGN" resolve="string" />
    </node>
    <node concept="1TJgyi" id="p720000000000000803" role="1TKVEl">
      <property role="TrG5h" value="sort" />
      <property role="IQ2nx" value="720000000000000803" />
      <ref role="AX2Wp" to="tpck:fKAOsGN" resolve="string" />
    </node>
    <node concept="1TJgyi" id="p720000000000000804" role="1TKVEl">
      <property role="TrG5h" value="nulls" />
      <property role="IQ2nx" value="720000000000000804" />
      <ref role="AX2Wp" to="tpck:fKAOsGN" resolve="string" />
    </node>
    <node concept="1TJgyi" id="p720000000000000805" role="1TKVEl">
      <property role="TrG5h" value="opclass" />
      <property role="IQ2nx" value="720000000000000805" />
      <ref role="AX2Wp" to="tpck:fKAOsGN" resolve="string" />
    </node>
    <node concept="PrWs8" id="n720000000000000008" role="PzmwI">
      <ref role="PrY4T" to="tpck:h0TrEE$" resolve="INamedConcept" />
    </node>
  </node>
  <node concept="1TIwiD" id="c720000000000000009">
    <property role="TrG5h" value="Constraint" />
    <property role="34LRSv" value="constraint" />
    <property role="EcuMT" value="720000000000000009" />
    <ref role="1TJDcQ" to="tpck:gw2VY9q" resolve="BaseConcept" />
    <node concept="1TJgyi" id="p720000000000000901" role="1TKVEl">
      <property role="TrG5h" value="kind" />
      <property role="IQ2nx" value="720000000000000901" />
      <ref role="AX2Wp" to="tpck:fKAOsGN" resolve="string" />
    </node>
    <node concept="1TJgyi" id="p720000000000000902" role="1TKVEl">
      <property role="TrG5h" value="columns" />
      <property role="IQ2nx" value="720000000000000902" />
      <ref role="AX2Wp" to="tpck:fKAOsGN" resolve="string" />
    </node>
    <node concept="1TJgyi" id="p720000000000000903" role="1TKVEl">
      <property role="TrG5h" value="expression" />
      <property role="IQ2nx" value="720000000000000903" />
      <ref role="AX2Wp" to="tpck:fKAOsGN" resolve="string" />
    </node>
    <node concept="1TJgyi" id="p720000000000000904" role="1TKVEl">
      <property role="TrG5h" value="onDelete" />
      <property role="IQ2nx" value="720000000000000904" />
      <ref role="AX2Wp" to="tpck:fKAOsGN" resolve="string" />
    </node>
    <node concept="1TJgyi" id="p720000000000000905" role="1TKVEl">
      <property role="TrG5h" value="onUpdate" />
      <property role="IQ2nx" value="720000000000000905" />
      <ref role="AX2Wp" to="tpck:fKAOsGN" resolve="string" />
    </node>
    <node concept="1TJgyi" id="p720000000000000906" role="1TKVEl">
      <property role="TrG5h" value="deferrable" />
      <property role="IQ2nx" value="720000000000000906" />
      <ref role="AX2Wp" to="tpck:fKAQMTB" resolve="boolean" />
    </node>
    <node concept="PrWs8" id="n720000000000000009" role="PzmwI">
      <ref role="PrY4T" to="tpck:h0TrEE$" resolve="INamedConcept" />
    </node>
  </node>
  <node concept="1TIwiD" id="c720000000000000010">
    <property role="TrG5h" value="CapabilityRequirement" />
    <property role="34LRSv" value="capability" />
    <property role="EcuMT" value="720000000000000010" />
    <ref role="1TJDcQ" to="tpck:gw2VY9q" resolve="BaseConcept" />
    <node concept="1TJgyi" id="p720000000001000002" role="1TKVEl">
      <property role="TrG5h" value="required" />
      <property role="IQ2nx" value="720000000001000002" />
      <ref role="AX2Wp" to="tpck:fKAQMTB" resolve="boolean" />
    </node>
    <node concept="1TJgyi" id="p720000000001000003" role="1TKVEl">
      <property role="TrG5h" value="fallback" />
      <property role="IQ2nx" value="720000000001000003" />
      <ref role="AX2Wp" to="tpck:fKAOsGN" resolve="string" />
    </node>
    <node concept="PrWs8" id="n720000000000000010" role="PzmwI">
      <ref role="PrY4T" to="tpck:h0TrEE$" resolve="INamedConcept" />
    </node>
  </node>
  <node concept="1TIwiD" id="c720000000000000011">
    <property role="TrG5h" value="Relation" />
    <property role="34LRSv" value="relation" />
    <property role="EcuMT" value="720000000000000011" />
    <ref role="1TJDcQ" to="tpck:gw2VY9q" resolve="BaseConcept" />
    <node concept="1TJgyi" id="p720000000000001101" role="1TKVEl">
      <property role="TrG5h" value="fromEntity" />
      <property role="IQ2nx" value="720000000000001101" />
      <ref role="AX2Wp" to="tpck:fKAOsGN" resolve="string" />
    </node>
    <node concept="1TJgyi" id="p720000000000001102" role="1TKVEl">
      <property role="TrG5h" value="fromField" />
      <property role="IQ2nx" value="720000000000001102" />
      <ref role="AX2Wp" to="tpck:fKAOsGN" resolve="string" />
    </node>
    <node concept="1TJgyi" id="p720000000000001103" role="1TKVEl">
      <property role="TrG5h" value="toEntity" />
      <property role="IQ2nx" value="720000000000001103" />
      <ref role="AX2Wp" to="tpck:fKAOsGN" resolve="string" />
    </node>
    <node concept="1TJgyi" id="p720000000000001104" role="1TKVEl">
      <property role="TrG5h" value="toField" />
      <property role="IQ2nx" value="720000000000001104" />
      <ref role="AX2Wp" to="tpck:fKAOsGN" resolve="string" />
    </node>
    <node concept="1TJgyi" id="p720000000000001105" role="1TKVEl">
      <property role="TrG5h" value="cardinality" />
      <property role="IQ2nx" value="720000000000001105" />
      <ref role="AX2Wp" to="tpck:fKAOsGN" resolve="string" />
    </node>
    <node concept="1TJgyi" id="p720000000000001106" role="1TKVEl">
      <property role="TrG5h" value="onDelete" />
      <property role="IQ2nx" value="720000000000001106" />
      <ref role="AX2Wp" to="tpck:fKAOsGN" resolve="string" />
    </node>
    <node concept="PrWs8" id="n720000000000000011" role="PzmwI">
      <ref role="PrY4T" to="tpck:h0TrEE$" resolve="INamedConcept" />
    </node>
  </node>
  <node concept="1TIwiD" id="c720000000000000023">
    <property role="TrG5h" value="WorkflowConfig" />
    <property role="34LRSv" value="workflow" />
    <property role="EcuMT" value="720000000000000023" />
    <ref role="1TJDcQ" to="tpck:gw2VY9q" resolve="BaseConcept" />
    <node concept="PrWs8" id="n720000000000000023" role="PzmwI"><ref role="PrY4T" to="tpck:h0TrEE$" resolve="INamedConcept" /></node>
  </node>
</model>

