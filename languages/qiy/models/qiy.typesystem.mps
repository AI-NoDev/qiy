<?xml version="1.0" encoding="UTF-8"?>
<model ref="r:66fb0ae9-8be5-475d-8e62-e405c8db05ae(qiy.typesystem)">
  <persistence version="9" />
  <languages>
    <use id="f3061a53-9226-4cc5-a443-f952ceaf5816" name="jetbrains.mps.baseLanguage" version="12" />
    <use id="7866978e-a0f0-4cc7-81bc-4d213d9375e1" name="jetbrains.mps.lang.smodel" version="19" />
    <use id="7a5dda62-9140-4668-ab76-d5ed1746f2b2" name="jetbrains.mps.lang.typesystem" version="5" />
    <devkit ref="00000000-0000-4000-0000-1de82b3a4936(jetbrains.mps.devkit.aspect.typesystem)" />
  </languages>
  <imports>
    <import index="qstr" ref="r:cdc08ce6-9a71-4f69-89bd-83f257b06f70(qiy.structure)" implicit="true" />
    <import index="tpck" ref="r:00000000-0000-4000-0000-011c89590288(jetbrains.mps.lang.core.structure)" implicit="true" />
    <import index="wyt6" ref="6354ebe7-c22a-4a0f-ac54-50b52ab9b065/java:java.lang(JDK/)" />
  </imports>
  <registry>
    <language id="f3061a53-9226-4cc5-a443-f952ceaf5816" name="jetbrains.mps.baseLanguage">
      <concept id="1197027756228" name="jetbrains.mps.baseLanguage.structure.DotExpression" flags="nn" index="2OqwBi">
        <child id="1197027771414" name="operand" index="2Oq$k0" />
        <child id="1197027833540" name="operation" index="2OqNvi" />
      </concept>
      <concept id="1202948039474" name="jetbrains.mps.baseLanguage.structure.InstanceMethodCallOperation" flags="nn" index="liA8E" />
      <concept id="1081236700937" name="jetbrains.mps.baseLanguage.structure.StaticMethodCall" flags="nn" index="qStaticMethodCall">
        <reference id="1144433194310" name="classConcept" index="qStaticClass" />
      </concept>
      <concept id="1070475926800" name="jetbrains.mps.baseLanguage.structure.StringLiteral" flags="nn" index="Xl_RD">
        <property id="1070475926801" name="value" index="Xl_RC" />
      </concept>
      <concept id="1068580320020" name="jetbrains.mps.baseLanguage.structure.IntegerConstant" flags="nn" index="3cmrfG">
        <property id="1068580320021" name="value" index="3cmrfH" />
      </concept>
      <concept id="1068580123159" name="jetbrains.mps.baseLanguage.structure.IfStatement" flags="nn" index="3clFbJ">
        <child id="1068580123160" name="condition" index="3clFbw" />
        <child id="1068580123161" name="ifTrue" index="3clFbx" />
      </concept>
      <concept id="1068580123136" name="jetbrains.mps.baseLanguage.structure.StatementList" flags="sn" stub="5293379017992965193" index="3clFbS">
        <child id="1068581517665" name="statement" index="3cqZAp" />
      </concept>
      <concept id="1068580123152" name="jetbrains.mps.baseLanguage.structure.EqualsExpression" flags="nn" index="3clFbC" />
      <concept id="1153422305557" name="jetbrains.mps.baseLanguage.structure.LessThanOrEqualsExpression" flags="nn" index="qLessEqual" />
      <concept id="1081506773034" name="jetbrains.mps.baseLanguage.structure.LessThanExpression" flags="nn" index="qLessThan" />
      <concept id="1073239437375" name="jetbrains.mps.baseLanguage.structure.NotEqualsExpression" flags="nn" index="3y3z36" />
      <concept id="1070534058343" name="jetbrains.mps.baseLanguage.structure.NullLiteral" flags="nn" index="10Nm6u" />
      <concept id="1081516740877" name="jetbrains.mps.baseLanguage.structure.NotExpression" flags="nn" index="3fqX7Q">
        <child id="1081516765348" name="expression" index="3fr31v" />
      </concept>
      <concept id="1081506762703" name="jetbrains.mps.baseLanguage.structure.GreaterThanExpression" flags="nn" index="qGreaterThan" />
      <concept id="1080120340718" name="jetbrains.mps.baseLanguage.structure.AndExpression" flags="nn" index="1Wc70l" />
      <concept id="1080223426719" name="jetbrains.mps.baseLanguage.structure.OrExpression" flags="nn" index="qOrExpression" />
      <concept id="1079359253375" name="jetbrains.mps.baseLanguage.structure.ParenthesizedExpression" flags="nn" index="qParenthesized">
        <child id="1079359253376" name="expression" index="qParenthesizedExpression" />
      </concept>
      <concept id="1081773326031" name="jetbrains.mps.baseLanguage.structure.BinaryOperation" flags="nn" index="3uHJSO">
        <child id="1081773367579" name="rightExpression" index="3uHU7w" />
        <child id="1081773367580" name="leftExpression" index="3uHU7B" />
      </concept>
      <concept id="1204053956946" name="jetbrains.mps.baseLanguage.structure.IMethodCall" flags="ngI" index="1ndlxa">
        <reference id="1068499141037" name="baseMethodDeclaration" index="37wK5l" />
        <child id="1068499141038" name="actualArgument" index="37wK5m" />
      </concept>
    </language>
    <language id="7a5dda62-9140-4668-ab76-d5ed1746f2b2" name="jetbrains.mps.lang.typesystem">
      <concept id="1175517767210" name="jetbrains.mps.lang.typesystem.structure.ReportErrorStatement" flags="nn" index="2MkqsV">
        <child id="1175517851849" name="errorString" index="2MkJ7o" />
      </concept>
      <concept id="1195213580585" name="jetbrains.mps.lang.typesystem.structure.AbstractCheckingRule" flags="ig" index="18hYwZ">
        <child id="1195213635060" name="body" index="18ibNy" />
      </concept>
      <concept id="1195214364922" name="jetbrains.mps.lang.typesystem.structure.NonTypesystemRule" flags="ig" index="18kY7G" />
      <concept id="3937244445246642777" name="jetbrains.mps.lang.typesystem.structure.AbstractReportStatement" flags="ng" index="1urrMJ">
        <child id="3937244445246642781" name="nodeToReport" index="1urrMF" />
      </concept>
      <concept id="1174642788531" name="jetbrains.mps.lang.typesystem.structure.ConceptReference" flags="ig" index="1YaCAy">
        <reference id="1174642800329" name="concept" index="1YaFvo" />
      </concept>
      <concept id="1174648085619" name="jetbrains.mps.lang.typesystem.structure.AbstractRule" flags="ng" index="1YuPPy">
        <child id="1174648101952" name="applicableNode" index="1YuTPh" />
      </concept>
      <concept id="1174650418652" name="jetbrains.mps.lang.typesystem.structure.ApplicableNodeReference" flags="nn" index="1YBJjd">
        <reference id="1174650432090" name="applicableNode" index="1YBMHb" />
      </concept>
    </language>
    <language id="7866978e-a0f0-4cc7-81bc-4d213d9375e1" name="jetbrains.mps.lang.smodel">
      <concept id="1138056022639" name="jetbrains.mps.lang.smodel.structure.SPropertyAccess" flags="nn" index="3TrcHB">
        <reference id="1138056395725" name="property" index="3TsBF5" />
      </concept>
    </language>
    <language id="ceab5195-25ea-4f22-9b92-103b95ca8c0c" name="jetbrains.mps.lang.core">
      <concept id="1169194658468" name="jetbrains.mps.lang.core.structure.INamedConcept" flags="ngI" index="TrEIO">
        <property id="1169194664001" name="name" index="TrG5h" />
      </concept>
    </language>
  </registry>
  <node concept="18kY7G" id="qiyFieldVectorCapabilityRule">
    <property role="TrG5h" value="check_FieldVectorCapability" />
    <node concept="3clFbS" id="qiyFieldVectorBody" role="18ibNy">
      <node concept="3clFbJ" id="qiyFieldVectorIf" role="3cqZAp">
        <node concept="1Wc70l" id="qiyFieldVectorCondition" role="3clFbw">
          <node concept="2OqwBi" id="qiyFieldVectorTypeEquals" role="3uHU7B">
            <node concept="Xl_RD" id="qiyFieldVectorTypeLiteral" role="2Oq$k0">
              <property role="Xl_RC" value="Vector" />
            </node>
            <node concept="liA8E" id="qiyFieldVectorTypeEqualsOperation" role="2OqNvi">
              <ref role="37wK5l" to="wyt6:~String.equals(java.lang.Object)" resolve="equals" />
              <node concept="2OqwBi" id="qiyFieldVectorTypeAccessArgument" role="37wK5m">
                <node concept="1YBJjd" id="qiyFieldVectorTypeField" role="2Oq$k0">
                  <ref role="1YBMHb" node="qiyFieldRuleField" resolve="field" />
                </node>
                <node concept="3TrcHB" id="qiyFieldVectorTypeProperty" role="2OqNvi">
                  <ref role="3TsBF5" to="qstr:p720000000000000601" resolve="type" />
                </node>
              </node>
            </node>
          </node>
          <node concept="3fqX7Q" id="qiyFieldVectorExtensionNotEquals" role="3uHU7w">
            <node concept="2OqwBi" id="qiyFieldVectorExtensionEqualsCall" role="3fr31v">
              <node concept="Xl_RD" id="qiyFieldVectorExtensionLiteral" role="2Oq$k0">
                <property role="Xl_RC" value="pgvector" />
              </node>
              <node concept="liA8E" id="qiyFieldVectorExtensionEqualsOperation" role="2OqNvi">
                <ref role="37wK5l" to="wyt6:~String.equals(java.lang.Object)" resolve="equals" />
                <node concept="2OqwBi" id="qiyFieldVectorExtensionAccessArgument" role="37wK5m">
                  <node concept="1YBJjd" id="qiyFieldVectorExtensionField" role="2Oq$k0">
                    <ref role="1YBMHb" node="qiyFieldRuleField" resolve="field" />
                  </node>
                  <node concept="3TrcHB" id="qiyFieldVectorExtensionProperty" role="2OqNvi">
                    <ref role="3TsBF5" to="qstr:p720000000000000608" resolve="extension" />
                  </node>
                </node>
              </node>
            </node>
          </node>
        </node>
        <node concept="3clFbS" id="qiyFieldVectorErrorBlock" role="3clFbx">
          <node concept="2MkqsV" id="qiyFieldVectorError" role="3cqZAp">
            <node concept="Xl_RD" id="qiyFieldVectorErrorMessage" role="2MkJ7o">
              <property role="Xl_RC" value="Vector fields require extension = pgvector" />
            </node>
            <node concept="1YBJjd" id="qiyFieldVectorReportNode" role="1urrMF">
              <ref role="1YBMHb" node="qiyFieldRuleField" resolve="field" />
            </node>
          </node>
        </node>
      </node>
      <node concept="3clFbJ" id="qiyFieldVectorDimensionIf" role="3cqZAp">
        <node concept="1Wc70l" id="qiyFieldVectorDimensionCondition" role="3clFbw">
          <node concept="2OqwBi" id="qiyFieldVectorDimensionTypeEquals" role="3uHU7B">
            <node concept="Xl_RD" id="qiyFieldVectorDimensionTypeLiteral" role="2Oq$k0">
              <property role="Xl_RC" value="Vector" />
            </node>
            <node concept="liA8E" id="qiyFieldVectorDimensionTypeEqualsOperation" role="2OqNvi">
              <ref role="37wK5l" to="wyt6:~String.equals(java.lang.Object)" resolve="equals" />
              <node concept="2OqwBi" id="qiyFieldVectorDimensionTypeAccessArgument" role="37wK5m">
                <node concept="1YBJjd" id="qiyFieldVectorDimensionTypeField" role="2Oq$k0">
                  <ref role="1YBMHb" node="qiyFieldRuleField" resolve="field" />
                </node>
                <node concept="3TrcHB" id="qiyFieldVectorDimensionTypeProperty" role="2OqNvi">
                  <ref role="3TsBF5" to="qstr:p720000000000000601" resolve="type" />
                </node>
              </node>
            </node>
          </node>
          <node concept="qLessEqual" id="qiyFieldVectorDimensionEqualsZero" role="3uHU7w">
            <node concept="2OqwBi" id="qiyFieldVectorDimensionAccess" role="3uHU7B">
              <node concept="1YBJjd" id="qiyFieldVectorDimensionField" role="2Oq$k0">
                <ref role="1YBMHb" node="qiyFieldRuleField" resolve="field" />
              </node>
              <node concept="3TrcHB" id="qiyFieldVectorDimensionProperty" role="2OqNvi">
                <ref role="3TsBF5" to="qstr:p720000000000000611" resolve="dimension" />
              </node>
            </node>
            <node concept="3cmrfG" id="qiyFieldVectorDimensionZero" role="3uHU7w">
              <property role="3cmrfH" value="0" />
            </node>
          </node>
        </node>
        <node concept="3clFbS" id="qiyFieldVectorDimensionErrorBlock" role="3clFbx">
          <node concept="2MkqsV" id="qiyFieldVectorDimensionError" role="3cqZAp">
            <node concept="Xl_RD" id="qiyFieldVectorDimensionErrorMessage" role="2MkJ7o">
              <property role="Xl_RC" value="Vector fields require dimension &gt; 0" />
            </node>
            <node concept="1YBJjd" id="qiyFieldVectorDimensionReportNode" role="1urrMF">
              <ref role="1YBMHb" node="qiyFieldRuleField" resolve="field" />
            </node>
          </node>
        </node>
      </node>
    </node>
    <node concept="1YaCAy" id="qiyFieldRuleField" role="1YuTPh">
      <property role="TrG5h" value="field" />
      <ref role="1YaFvo" to="qstr:c720000000000000006" resolve="Field" />
    </node>
  </node>
  <node concept="18kY7G" id="qiyFieldDecimalPrecisionRule">
    <property role="TrG5h" value="check_FieldDecimalPrecision" />
    <node concept="3clFbS" id="qiyFieldDecimalBody" role="18ibNy">
      <node concept="3clFbJ" id="qiyDecimalPrecisionIf" role="3cqZAp">
        <node concept="1Wc70l" id="qiyDecimalPrecisionCondition" role="3clFbw">
          <node concept="qParenthesized" id="qiyDecimalTypesGrouped" role="3uHU7B">
            <node concept="qOrExpression" id="qiyDecimalOrMoney" role="qParenthesizedExpression">
            <node concept="2OqwBi" id="qiyDecimalTypeEquals" role="3uHU7B">
              <node concept="Xl_RD" id="qiyDecimalTypeLiteral" role="2Oq$k0">
                <property role="Xl_RC" value="Decimal" />
              </node>
              <node concept="liA8E" id="qiyDecimalTypeEqualsOperation" role="2OqNvi">
                <ref role="37wK5l" to="wyt6:~String.equals(java.lang.Object)" resolve="equals" />
                <node concept="2OqwBi" id="qiyDecimalTypeAccess" role="37wK5m">
                  <node concept="1YBJjd" id="qiyDecimalTypeField" role="2Oq$k0">
                    <ref role="1YBMHb" node="qiyDecimalField" resolve="field" />
                  </node>
                  <node concept="3TrcHB" id="qiyDecimalTypeProperty" role="2OqNvi">
                    <ref role="3TsBF5" to="qstr:p720000000000000601" resolve="type" />
                  </node>
                </node>
              </node>
            </node>
            <node concept="2OqwBi" id="qiyMoneyTypeEquals" role="3uHU7w">
              <node concept="Xl_RD" id="qiyMoneyTypeLiteral" role="2Oq$k0">
                <property role="Xl_RC" value="Money" />
              </node>
              <node concept="liA8E" id="qiyMoneyTypeEqualsOperation" role="2OqNvi">
                <ref role="37wK5l" to="wyt6:~String.equals(java.lang.Object)" resolve="equals" />
                <node concept="2OqwBi" id="qiyMoneyTypeAccess" role="37wK5m">
                  <node concept="1YBJjd" id="qiyMoneyTypeField" role="2Oq$k0">
                    <ref role="1YBMHb" node="qiyDecimalField" resolve="field" />
                  </node>
                  <node concept="3TrcHB" id="qiyMoneyTypeProperty" role="2OqNvi">
                    <ref role="3TsBF5" to="qstr:p720000000000000601" resolve="type" />
                  </node>
                </node>
              </node>
            </node>
            </node>
          </node>
          <node concept="qLessEqual" id="qiyDecimalPrecisionNonPositive" role="3uHU7w">
            <node concept="2OqwBi" id="qiyDecimalPrecisionAccess" role="3uHU7B">
              <node concept="1YBJjd" id="qiyDecimalPrecisionField" role="2Oq$k0">
                <ref role="1YBMHb" node="qiyDecimalField" resolve="field" />
              </node>
              <node concept="3TrcHB" id="qiyDecimalPrecisionProperty" role="2OqNvi">
                <ref role="3TsBF5" to="qstr:p720000000000000612" resolve="precision" />
              </node>
            </node>
            <node concept="3cmrfG" id="qiyDecimalPrecisionZero" role="3uHU7w">
              <property role="3cmrfH" value="0" />
            </node>
          </node>
        </node>
        <node concept="3clFbS" id="qiyDecimalPrecisionErrorBlock" role="3clFbx">
          <node concept="2MkqsV" id="qiyDecimalPrecisionError" role="3cqZAp">
            <node concept="Xl_RD" id="qiyDecimalPrecisionErrorMessage" role="2MkJ7o">
              <property role="Xl_RC" value="Decimal and Money fields require precision &gt; 0" />
            </node>
            <node concept="1YBJjd" id="qiyDecimalPrecisionReportNode" role="1urrMF">
              <ref role="1YBMHb" node="qiyDecimalField" resolve="field" />
            </node>
          </node>
        </node>
      </node>
      <node concept="3clFbJ" id="qiyDecimalScaleValidIf" role="3cqZAp">
        <node concept="1Wc70l" id="qiyDecimalScaleValidCondition" role="3clFbw">
          <node concept="3y3z36" id="qiyDecimalScalePresent" role="3uHU7B">
            <node concept="2OqwBi" id="qiyDecimalScalePresentAccess" role="3uHU7B">
              <node concept="1YBJjd" id="qiyDecimalScalePresentField" role="2Oq$k0"><ref role="1YBMHb" node="qiyDecimalField" resolve="field" /></node>
              <node concept="3TrcHB" id="qiyDecimalScalePresentProperty" role="2OqNvi"><ref role="3TsBF5" to="qstr:p720000000000000613" resolve="scale" /></node>
            </node>
            <node concept="10Nm6u" id="qiyDecimalScalePresentNull" role="3uHU7w" />
          </node>
          <node concept="2OqwBi" id="qiyDecimalScaleMatches" role="3uHU7w">
            <node concept="2OqwBi" id="qiyDecimalScaleMatchesAccess" role="2Oq$k0">
              <node concept="1YBJjd" id="qiyDecimalScaleMatchesField" role="2Oq$k0"><ref role="1YBMHb" node="qiyDecimalField" resolve="field" /></node>
              <node concept="3TrcHB" id="qiyDecimalScaleMatchesProperty" role="2OqNvi"><ref role="3TsBF5" to="qstr:p720000000000000613" resolve="scale" /></node>
            </node>
            <node concept="liA8E" id="qiyDecimalScaleMatchesOperation" role="2OqNvi">
              <ref role="37wK5l" to="wyt6:~String.matches(java.lang.String)" resolve="matches" />
              <node concept="Xl_RD" id="qiyDecimalScaleMatchesPattern" role="37wK5m"><property role="Xl_RC" value="-?[0-9]{1,9}" /></node>
            </node>
          </node>
        </node>
        <node concept="3clFbS" id="qiyDecimalScaleValidBlock" role="3clFbx">
      <node concept="3clFbJ" id="qiyDecimalScaleNegativeIf" role="3cqZAp">
        <node concept="qLessThan" id="qiyDecimalScaleNegative" role="3clFbw">
          <node concept="qStaticMethodCall" id="qiyDecimalScaleParse" role="3uHU7B">
            <ref role="qStaticClass" to="wyt6:~Integer" resolve="Integer" />
            <ref role="37wK5l" to="wyt6:~Integer.parseInt(java.lang.String)" resolve="parseInt" />
            <node concept="2OqwBi" id="qiyDecimalScaleAccess" role="37wK5m">
              <node concept="1YBJjd" id="qiyDecimalScaleField" role="2Oq$k0">
                <ref role="1YBMHb" node="qiyDecimalField" resolve="field" />
              </node>
              <node concept="3TrcHB" id="qiyDecimalScaleProperty" role="2OqNvi">
                <ref role="3TsBF5" to="qstr:p720000000000000613" resolve="scale" />
              </node>
            </node>
          </node>
          <node concept="3cmrfG" id="qiyDecimalScaleZero" role="3uHU7w">
            <property role="3cmrfH" value="0" />
          </node>
        </node>
        <node concept="3clFbS" id="qiyDecimalScaleNegativeErrorBlock" role="3clFbx">
          <node concept="2MkqsV" id="qiyDecimalScaleNegativeError" role="3cqZAp">
            <node concept="Xl_RD" id="qiyDecimalScaleNegativeMessage" role="2MkJ7o">
              <property role="Xl_RC" value="Field scale must be &gt;= 0" />
            </node>
            <node concept="1YBJjd" id="qiyDecimalScaleNegativeReport" role="1urrMF">
              <ref role="1YBMHb" node="qiyDecimalField" resolve="field" />
            </node>
          </node>
        </node>
      </node>
      <node concept="3clFbJ" id="qiyDecimalScaleTooLargeIf" role="3cqZAp">
        <node concept="qGreaterThan" id="qiyDecimalScaleTooLarge" role="3clFbw">
          <node concept="qStaticMethodCall" id="qiyDecimalScaleUpperParse" role="3uHU7B">
            <ref role="qStaticClass" to="wyt6:~Integer" resolve="Integer" />
            <ref role="37wK5l" to="wyt6:~Integer.parseInt(java.lang.String)" resolve="parseInt" />
            <node concept="2OqwBi" id="qiyDecimalScaleUpperAccess" role="37wK5m">
              <node concept="1YBJjd" id="qiyDecimalScaleUpperField" role="2Oq$k0">
                <ref role="1YBMHb" node="qiyDecimalField" resolve="field" />
              </node>
              <node concept="3TrcHB" id="qiyDecimalScaleUpperProperty" role="2OqNvi">
                <ref role="3TsBF5" to="qstr:p720000000000000613" resolve="scale" />
              </node>
            </node>
          </node>
          <node concept="2OqwBi" id="qiyDecimalPrecisionUpperAccess" role="3uHU7w">
            <node concept="1YBJjd" id="qiyDecimalPrecisionUpperField" role="2Oq$k0">
              <ref role="1YBMHb" node="qiyDecimalField" resolve="field" />
            </node>
            <node concept="3TrcHB" id="qiyDecimalPrecisionUpperProperty" role="2OqNvi">
              <ref role="3TsBF5" to="qstr:p720000000000000612" resolve="precision" />
            </node>
          </node>
        </node>
        <node concept="3clFbS" id="qiyDecimalScaleTooLargeErrorBlock" role="3clFbx">
          <node concept="2MkqsV" id="qiyDecimalScaleTooLargeError" role="3cqZAp">
            <node concept="Xl_RD" id="qiyDecimalScaleTooLargeMessage" role="2MkJ7o">
              <property role="Xl_RC" value="Field scale must not exceed precision" />
            </node>
            <node concept="1YBJjd" id="qiyDecimalScaleTooLargeReport" role="1urrMF">
              <ref role="1YBMHb" node="qiyDecimalField" resolve="field" />
            </node>
          </node>
        </node>
      </node>
        </node>
      </node>
      <node concept="3clFbJ" id="qiyDecimalScaleInvalidIf" role="3cqZAp">
        <node concept="1Wc70l" id="qiyDecimalScaleInvalidCondition" role="3clFbw">
          <node concept="3y3z36" id="qiyDecimalScaleInvalidPresent" role="3uHU7B">
            <node concept="2OqwBi" id="qiyDecimalScaleInvalidPresentAccess" role="3uHU7B">
              <node concept="1YBJjd" id="qiyDecimalScaleInvalidPresentField" role="2Oq$k0"><ref role="1YBMHb" node="qiyDecimalField" resolve="field" /></node>
              <node concept="3TrcHB" id="qiyDecimalScaleInvalidPresentProperty" role="2OqNvi"><ref role="3TsBF5" to="qstr:p720000000000000613" resolve="scale" /></node>
            </node>
            <node concept="10Nm6u" id="qiyDecimalScaleInvalidNull" role="3uHU7w" />
          </node>
          <node concept="3fqX7Q" id="qiyDecimalScaleInvalidNot" role="3uHU7w">
            <node concept="2OqwBi" id="qiyDecimalScaleInvalidMatches" role="3fr31v">
              <node concept="2OqwBi" id="qiyDecimalScaleInvalidMatchesAccess" role="2Oq$k0">
                <node concept="1YBJjd" id="qiyDecimalScaleInvalidMatchesField" role="2Oq$k0"><ref role="1YBMHb" node="qiyDecimalField" resolve="field" /></node>
                <node concept="3TrcHB" id="qiyDecimalScaleInvalidMatchesProperty" role="2OqNvi"><ref role="3TsBF5" to="qstr:p720000000000000613" resolve="scale" /></node>
              </node>
              <node concept="liA8E" id="qiyDecimalScaleInvalidMatchesOperation" role="2OqNvi">
                <ref role="37wK5l" to="wyt6:~String.matches(java.lang.String)" resolve="matches" />
                <node concept="Xl_RD" id="qiyDecimalScaleInvalidPattern" role="37wK5m"><property role="Xl_RC" value="-?[0-9]{1,9}" /></node>
              </node>
            </node>
          </node>
        </node>
        <node concept="3clFbS" id="qiyDecimalScaleInvalidErrorBlock" role="3clFbx">
          <node concept="2MkqsV" id="qiyDecimalScaleInvalidError" role="3cqZAp">
            <node concept="Xl_RD" id="qiyDecimalScaleInvalidMessage" role="2MkJ7o"><property role="Xl_RC" value="Field scale must be a signed integer with up to 9 digits" /></node>
            <node concept="1YBJjd" id="qiyDecimalScaleInvalidReport" role="1urrMF"><ref role="1YBMHb" node="qiyDecimalField" resolve="field" /></node>
          </node>
        </node>
      </node>
    </node>
    <node concept="1YaCAy" id="qiyDecimalField" role="1YuTPh">
      <property role="TrG5h" value="field" />
      <ref role="1YaFvo" to="qstr:c720000000000000006" resolve="Field" />
    </node>
  </node>
</model>

